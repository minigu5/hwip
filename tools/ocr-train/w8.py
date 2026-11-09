"""가중치 전용 int8 압축 (Conv/MatMul/Gather 가중치를 채널별 int8 + DequantizeLinear로). 연산은 fp32 그대로.
사용: python w8.py <src.onnx> <dst.onnx>
"""
import sys
import numpy as np
import onnx
from onnx import numpy_helper, helper, TensorProto

def weight_only(src, dst, bits_axis=True):
    """큰 Conv/MatMul 가중치를 int8(채널별 대칭) + DequantizeLinear로 저장. 연산은 fp32 그대로."""
    m = onnx.load(src)
    subs = [a.g for n in m.graph.node for a in n.attribute if a.type == onnx.AttributeProto.GRAPH]
    # merged 디코더는 가중치가 바깥 그래프에 있고 If 분기 서브그래프에서 쓰인다 → 사용처를 전부 모은다
    use = {}
    for n in list(m.graph.node) + [n for sg in subs for n in sg.node]:
        if n.op_type == 'Gather' and n.input: use.setdefault(n.input[0], 'Gather')
    for g in [m.graph]:
        for n in list(m.graph.node) + [n for sg in subs for n in sg.node]:
            if n.op_type == 'Conv' and len(n.input) > 1: use.setdefault(n.input[1], 'Conv')
            if n.op_type in ('MatMul', 'Gemm'):
                for i in n.input: use.setdefault(i, 'MatMul')
        new_inits, new_nodes = [], []
        for init in list(g.initializer):
            if init.name not in use or init.data_type != TensorProto.FLOAT: continue
            w = numpy_helper.to_array(init)
            if w.size < 1024 or w.ndim < 2: continue
            axis = 0 if use[init.name] in ('Conv', 'Gather') else w.ndim - 1   # Conv: 출력채널, MatMul: 출력열
            red = tuple(i for i in range(w.ndim) if i != axis)
            scale = np.abs(w).max(axis=red) / 127.0
            scale[scale == 0] = 1e-8
            shp = [1] * w.ndim; shp[axis] = -1
            q = np.clip(np.round(w / scale.reshape(shp)), -127, 127).astype(np.int8)
            g.initializer.remove(init)
            qn, sn = init.name + '_q', init.name + '_s'
            new_inits += [numpy_helper.from_array(q, qn), numpy_helper.from_array(scale.astype(np.float32), sn)]
            new_nodes.append(helper.make_node('DequantizeLinear', [qn, sn], [init.name], axis=axis, name=init.name + '_dq'))
        g.initializer.extend(new_inits)
        # 노드는 위상 순서를 지키기 위해 앞에 둔다
        old = list(g.node); del g.node[:]; g.node.extend(new_nodes + old)
    onnx.save(m, dst)


if __name__ == '__main__':
    weight_only(sys.argv[1], sys.argv[2])
