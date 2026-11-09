import onnx, numpy as np, shutil, os, sys
from onnx import numpy_helper, helper, TensorProto
from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxconverter_common import float16

ROOT = sys.argv[1]
SRC = os.path.join(ROOT, 'fp32')
FILES = ['encoder_model', 'decoder_model_merged']

def setup(name):
    dst = os.path.join(ROOT, name)
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(SRC, dst)
    return dst

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

variants = sys.argv[2].split(',')
for v in variants:
    dst = setup(v)
    for f in FILES:
        src = os.path.join(SRC, 'onnx', f + '.onnx'); out = os.path.join(dst, 'onnx', f + '.onnx')
        if v == 'fp16':
            m = float16.convert_float_to_float16(onnx.load(src), keep_io_types=True)
            onnx.save(m, out)
        elif f == 'decoder_model_merged' and v != 'fp16':
            weight_only(src, out)  # quantize_dynamic은 If 서브그래프 가중치를 못 건드려 디코더는 가중치 전용으로
        elif v == 'dq8':      # transformers.js 표준 q8 (uint8, 텐서별)
            quantize_dynamic(src, out, weight_type=QuantType.QUInt8, per_channel=False)
        elif v == 'dq8pc':    # 채널별 int8 동적
            quantize_dynamic(src, out, weight_type=QuantType.QInt8, per_channel=True)
        elif v == 'w8':       # 가중치 전용 int8
            weight_only(src, out)
        onnx.checker.check_model(out)
    print(v, {f: round(os.path.getsize(os.path.join(dst, 'onnx', f + '.onnx')) / 1e6, 1) for f in FILES})
