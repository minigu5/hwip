/*
 * 이미지 → LaTeX OCR 워커 (브라우저 로컬 실행)
 *
 * 모델: alephpi/FormulaNet (PP-FormulaNet-S 기반 파인튜닝, 20M 파라미터, ONNX)
 *   - HuggingFace Hub에서 최초 1회 내려받아 브라우저 Cache Storage에 저장된다(약 80MB).
 *   - 추론은 onnxruntime-web(WASM)으로 이 워커(별도 스레드)에서 수행 → UI를 막지 않는다.
 *   - 라이선스: 모델 가중치는 AGPL-3.0. (런타임 라이브러리 transformers.js는 Apache-2.0)
 *
 * 메인 스레드는 이미지를 384x384 그레이스케일로 전처리한 Float32Array(길이 147456)를
 * 보내고, 이 워커는 그것으로 텐서를 만들어 모델을 돌린 뒤 LaTeX 문자열을 돌려준다.
 * 전처리 규칙과 모델 사용법은 작동이 검증된 Texo-web(동일 모델 저자) 구현을 따른다.
 */

import {
  env,
  VisionEncoderDecoderModel,
  PreTrainedTokenizer,
  Tensor,
  cat
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';

// 브라우저에서는 로컬 모델 파일을 찾지 않고 항상 원격(HF Hub)에서 받는다.
env.allowLocalModels = false;

var MODEL_NAME = 'alephpi/FormulaNet';
var OCR_SIZE = 384;

var model = null;
var tokenizer = null;
var initialized = false;

function post(msg) { globalThis.postMessage(msg); }

async function init() {
  if (initialized) { post({ status: 'ready' }); return; }

  model = await VisionEncoderDecoderModel.from_pretrained(MODEL_NAME, {
    dtype: 'fp32',
    progress_callback: function (data) { post({ status: 'progress', data: data }); }
  });
  tokenizer = await PreTrainedTokenizer.from_pretrained(MODEL_NAME);

  initialized = true;
  post({ status: 'ready' });
}

async function predict(array, key) {
  if (!initialized) throw new Error('모델이 아직 초기화되지 않았습니다.');

  // 전처리된 1채널(384x384) 텐서를 3채널로 복제해 인코더 입력 형태로 맞춘다.
  var single = new Tensor('float32', array, [1, 1, OCR_SIZE, OCR_SIZE]);
  var pixelValues = cat([single, single, single], 1); // [1, 3, 384, 384]

  var outputs = await model.generate({ inputs: pixelValues });
  var text = tokenizer.batch_decode(outputs, { skip_special_tokens: true })[0];

  post({ status: 'result', text: text, key: key });
}

self.onmessage = async function (event) {
  var msg = event.data || {};
  try {
    if (msg.action === 'init') {
      await init();
    } else if (msg.action === 'predict') {
      await predict(msg.array, msg.key);
    }
  } catch (error) {
    post({
      status: 'error',
      error: (error && error.message) ? error.message : String(error),
      key: msg.key || null
    });
  }
};
