# Petit modele de test (meme entree et sortie que BiRefNet) : « personne » = couleur saturee
# qui n'est pas verte. Le fond vert et la salle (gris, beige peu sature) sont du fond.
import sys, numpy as np, onnx
from onnx import helper, TensorProto, numpy_helper
mean = np.array([0.485, 0.456, 0.406], np.float32); std = np.array([0.229, 0.224, 0.225], np.float32)
W1 = np.zeros((3, 3, 1, 1), np.float32)
for c in range(3): W1[c, c, 0, 0] = std[c]
# vert dominant : [G - R, G - B]
W2 = np.zeros((2, 3, 1, 1), np.float32); W2[0, 1] = 1; W2[0, 0] = -1; W2[1, 1] = 1; W2[1, 2] = -1
init = [numpy_helper.from_array(W1, 'w1'), numpy_helper.from_array(mean, 'b1'), numpy_helper.from_array(W2, 'w2'),
        numpy_helper.from_array(np.array([0.2], np.float32), 's'), numpy_helper.from_array(np.array([60.0], np.float32), 'k'),
        numpy_helper.from_array(np.array([200.0], np.float32), 'kv')]
n = [
  helper.make_node('Conv', ['input_image', 'w1', 'b1'], ['v']),
  helper.make_node('ReduceMax', ['v'], ['mx'], axes=[1], keepdims=1),
  helper.make_node('ReduceMin', ['v'], ['mn'], axes=[1], keepdims=1),
  helper.make_node('Sub', ['mx', 'mn'], ['chroma']),
  helper.make_node('Conv', ['v', 'w2'], ['gv']),
  helper.make_node('ReduceMin', ['gv'], ['vert'], axes=[1], keepdims=1),
  helper.make_node('Relu', ['vert'], ['vp']),
  helper.make_node('Sub', ['chroma', 's'], ['c2']),
  helper.make_node('Mul', ['c2', 'k'], ['c3']),
  helper.make_node('Mul', ['vp', 'kv'], ['v3']),
  helper.make_node('Sub', ['c3', 'v3'], ['output_image']),
]
g = helper.make_graph(n, 'test', [helper.make_tensor_value_info('input_image', TensorProto.FLOAT, [1, 3, 1024, 1024])],
                      [helper.make_tensor_value_info('output_image', TensorProto.FLOAT, [1, 1, 1024, 1024])], init)
m = helper.make_model(g, opset_imports=[helper.make_opsetid('', 17)]); m.ir_version = 8
onnx.checker.check_model(m)
onnx.save(m, sys.argv[1])
