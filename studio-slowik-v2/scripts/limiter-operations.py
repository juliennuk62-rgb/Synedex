# Prepare un modele ONNX pour la carte graphique du navigateur (WebGPU, onnxruntime-web). Le
# resultat du modele est identique.
# - Une operation n'y peut lire et ecrire que 8 tableaux a la fois : les decoupages (Split) et
#   assemblages (Concat) de plus de 7 morceaux deviennent des cascades de 7 morceaux au plus.
# - GatherND et Sum n'existent pas sur la carte graphique : calcules par le processeur, leurs
#   tableaux (jusqu'a 800 Mo) depassent la memoire du navigateur. GatherND (batch_dims = 2,
#   lots de taille 1) devient un Gather sur le tableau aplati ; Sum devient une cascade d'Add.
# Usage : python3 scripts/limiter-operations.py entree.onnx sortie.onnx
import sys, onnx, numpy as np
from onnx import helper, numpy_helper, shape_inference

MAX = 7
src, dst = sys.argv[1:3]
m = onnx.load(src)
g = m.graph
formes = {}
for v in list(shape_inference.infer_shapes(onnx.load(src, load_external_data=False)).graph.value_info) + list(g.input):
    formes[v.name] = [d.dim_value for d in v.type.tensor_type.shape.dim]
consts = {n.output[0]: n for n in g.node if n.op_type == 'Constant'}
inits = {t.name: t for t in g.initializer}
compteur = [0]

def nom(base):
    compteur[0] += 1
    return f'{base}__lim{compteur[0]}'

def valeurs(name):
    if name in inits:
        return numpy_helper.to_array(inits[name]).tolist()
    n = consts[name]
    return numpy_helper.to_array(n.attribute[0].t).tolist()

def axe(n):
    return next(helper.get_attribute_value(a) for a in n.attribute if a.name == 'axis')

def concat(inputs, axis, sortie, base):
    out = []
    while len(inputs) > MAX:
        suivants = []
        for i in range(0, len(inputs), MAX):
            part = inputs[i:i + MAX]
            if len(part) == 1:
                suivants.append(part[0]); continue
            o = nom(base)
            out.append(helper.make_node('Concat', part, [o], axis=axis, name=o))
            suivants.append(o)
        inputs = suivants
    out.append(helper.make_node('Concat', inputs, [sortie], axis=axis, name=nom(base)))
    return out

def split(x, tailles, sorties, axis, base):
    if len(sorties) <= MAX:
        t = nom(base + '_tailles')
        return [helper.make_node('Constant', [], [t], value=numpy_helper.from_array(__import__('numpy').array(tailles, dtype='int64'))),
                helper.make_node('Split', [x, t], sorties, axis=axis, name=nom(base))]
    # groupes de morceaux consecutifs, chacun decoupe ensuite
    k = -(-len(sorties) // MAX)
    taille_g = -(-len(sorties) // k)
    groupes = [(tailles[i:i + taille_g], sorties[i:i + taille_g]) for i in range(0, len(sorties), taille_g)]
    inter = [nom(base) for _ in groupes]
    out = split(x, [sum(t) for t, _ in groupes], inter, axis, base)
    for (t, s), xi in zip(groupes, inter):
        if len(s) == 1:
            out.append(helper.make_node('Identity', [xi], s, name=nom(base)))
        else:
            out += split(xi, t, s, axis, base)
    return out

def cst(base, valeur):
    t = nom(base + '_cst')
    return t, helper.make_node('Constant', [], [t], value=numpy_helper.from_array(np.array(valeur, dtype='int64')))

def gather_nd(n):
    bd = next((helper.get_attribute_value(a) for a in n.attribute if a.name == 'batch_dims'), 0)
    data, idx = n.input
    fd, fi = formes[data], formes[idx]
    if bd < 1 or any(d != 1 for d in fd[:bd]) or fi[-1] != 2 or len(fd) != bd + 3 or 0 in fd + fi:
        raise SystemExit(f'GatherND non pris en charge : {n.name} {fd} {fi} batch_dims={bd}')
    H, W, C = fd[bd:]
    N = int(np.prod(fi[bd:-1]))
    base = n.name or 'gathernd'
    out = []
    c0, k0 = cst(base, 0); c1, k1 = cst(base, 1); cw, kw = cst(base, W)
    fp, kp = cst(base, fd[:bd] + [H * W, C]); fn, kn = cst(base, [N])
    out += [k0, k1, kw, kp, kn]
    i0, i1, l0, lin, linf, dflat = (nom(base) for _ in range(6))
    out += [helper.make_node('Gather', [idx, c0], [i0], axis=len(fi) - 1, name=nom(base)),
            helper.make_node('Gather', [idx, c1], [i1], axis=len(fi) - 1, name=nom(base)),
            helper.make_node('Mul', [i0, cw], [l0], name=nom(base)),
            helper.make_node('Add', [l0, i1], [lin], name=nom(base)),
            helper.make_node('Reshape', [lin, fn], [linf], name=nom(base)),
            helper.make_node('Reshape', [data, fp], [dflat], name=nom(base))]
    if fi[bd:-1] == [N]:
        out.append(helper.make_node('Gather', [dflat, linf], [n.output[0]], axis=bd, name=nom(base)))
    else:
        g2 = nom(base); fo, ko = cst(base, fd[:bd] + fi[bd:-1] + [C]); out.append(ko)
        out += [helper.make_node('Gather', [dflat, linf], [g2], axis=bd, name=nom(base)),
                helper.make_node('Reshape', [g2, fo], [n.output[0]], name=nom(base))]
    return out

def somme(n):
    base = n.name or 'sum'
    termes = list(n.input)
    out = []
    while len(termes) > 2:
        suivants = []
        for i in range(0, len(termes) - 1, 2):
            o = nom(base); out.append(helper.make_node('Add', termes[i:i + 2], [o], name=o)); suivants.append(o)
        if len(termes) % 2: suivants.append(termes[-1])
        termes = suivants
    out.append(helper.make_node('Add', termes, [n.output[0]], name=nom(base)) if len(termes) == 2
               else helper.make_node('Identity', termes, [n.output[0]], name=nom(base)))
    return out

noeuds, n_concat, n_split, n_gnd, n_sum = [], 0, 0, 0, 0
for n in g.node:
    if n.op_type == 'Concat' and len(n.input) > MAX:
        noeuds += concat(list(n.input), axe(n), n.output[0], n.name or 'concat'); n_concat += 1
    elif n.op_type == 'Split' and len(n.output) > MAX:
        if len(n.input) < 2 or not n.input[1]:
            raise SystemExit(f'Split sans tailles : {n.name}')
        noeuds += split(n.input[0], valeurs(n.input[1]), list(n.output), axe(n), n.name or 'split'); n_split += 1
    elif n.op_type == 'GatherND':
        noeuds += gather_nd(n); n_gnd += 1
    elif n.op_type == 'Sum':
        noeuds += somme(n); n_sum += 1
    else:
        noeuds.append(n)
# constantes devenues inutiles (anciennes tailles des decoupages)
utilises = {i for n in noeuds for i in n.input} | {o.name for o in g.output}
noeuds = [n for n in noeuds if n.op_type != 'Constant' or n.output[0] in utilises]
del g.node[:]
g.node.extend(noeuds)
onnx.save(m, dst)
print(f'Concat remplaces : {n_concat}, Split remplaces : {n_split}, GatherND remplaces : {n_gnd}, Sum remplaces : {n_sum}')
