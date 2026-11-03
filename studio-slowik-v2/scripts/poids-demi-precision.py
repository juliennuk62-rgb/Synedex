# Poids stockes en float16, calcul en float32 : chaque poids float32 devient un initialiseur
# float16 suivi d'un Cast vers float32 (replie a l'ouverture par ONNX Runtime).
import sys, onnx, numpy as np
from onnx import numpy_helper, helper, TensorProto
src, dst = sys.argv[1:3]
m = onnx.load(src)
g = m.graph
nouveaux, casts, n16 = [], [], 0
for t in g.initializer:
    if t.data_type == TensorProto.FLOAT and np.prod(t.dims) >= 16:
        a = numpy_helper.to_array(t)
        h = numpy_helper.from_array(a.astype(np.float16), t.name + '__f16')
        nouveaux.append(h)
        casts.append(helper.make_node('Cast', [h.name], [t.name], to=TensorProto.FLOAT, name=t.name + '__cast'))
        n16 += 1
    else:
        nouveaux.append(t)
del g.initializer[:]
g.initializer.extend(nouveaux)
noeuds = casts + list(g.node)
del g.node[:]
g.node.extend(noeuds)
onnx.save(m, dst)
print('poids convertis', n16)
