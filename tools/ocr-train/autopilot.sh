#!/bin/bash
# 학습 종료 후: 체크포인트별 ONNX 내보내기 → w8 압축 → 브라우저 벤치(MathJax+mpl) → 재채점 → UniMER 평가 → 요약
R=~/hwip-ocr; B=$R/bench; PY=$R/Texo/.venv/bin/python; export PATH=$R/node/bin:$PATH
cd $R
echo "autopilot start $(date)" > autopilot.status
while ! grep -q "train exit" ft1.status; do sleep 30; done
echo "train finished $(date)" >> autopilot.status
mkdir -p $B/results $B/web/models
for C in base mid best last; do
  case $C in base) CK=model;; mid) CK=ck_mid;; best) CK=runs/ft1/best;; last) CK=runs/ft1/last;; esac
  EX=export_$C
  if [ ! -f $EX/encoder_model.onnx ]; then
    cp model/generation_config.json $CK/ 2>/dev/null
    (cd Texo && $PY ../export.py ../$CK ../$EX > ../$EX.log 2>&1)
  fi
  M=$B/web/models/${C}_w8; rm -rf $M; mkdir -p $M/onnx
  for f in config.json generation_config.json special_tokens_map.json tokenizer.json tokenizer_config.json; do cp $EX/$f $M/; cp $EX/$f $M/onnx/; done
  $PY $B/w8.py $EX/encoder_model.onnx $M/onnx/encoder_model.onnx
  $PY $B/w8.py $EX/decoder_model_merged.onnx $M/onnx/decoder_model_merged.onnx
  echo "$C exported+quantized $(du -sh $M/onnx | cut -f1) $(date)" >> autopilot.status
  for SRC in mj mpl; do
    OUT=$B/results/$C-$SRC.jsonl; rm -f $OUT
    python3 $B/server.py $B/web $OUT & SP=$!; sleep 1
    Q="v=${C}_w8"; [ $SRC = mpl ] && Q="$Q&src=mpl"
    node $R/render/bench_run.js "http://127.0.0.1:5288/harness.html?$Q" FINISHED 150 >> autopilot.status 2>&1
    kill $SP; sleep 1
    ln -sf ../results/$C-$SRC.jsonl $B/web/$C-$SRC.jsonl
    RS=$B/results/$C-$SRC.rescore.json; rm -f $RS
    python3 $B/server.py $B/web $RS & SP=$!; sleep 1
    node $R/render/bench_run.js "http://127.0.0.1:5288/rescore.html?f=$C-$SRC.jsonl" RESCORED 60 >> autopilot.status 2>&1
    kill $SP; sleep 1
  done
  echo "$C bench done $(date)" >> autopilot.status
  $PY eval_unimer.py $CK 600 2>/dev/null | tail -1 > $B/results/$C-unimer.json
  echo "$C unimer done $(date)" >> autopilot.status
done
$PY $B/summarize.py $B/results > $B/results/SUMMARY.md 2>&1
echo "AUTOPILOT DONE $(date)" >> autopilot.status
