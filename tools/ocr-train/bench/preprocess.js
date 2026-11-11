// app.js에서 그대로 복사
var OCR_SIZE=384, UNIMER_MEAN=0.7931, UNIMER_STD=0.1738;
  function preprocessImage(blob) {
    return createImageBitmap(blob).then(function (bmp) {
      var W = bmp.width, H = bmp.height;
      var base = document.createElement('canvas');
      base.width = W; base.height = H;
      var bx = base.getContext('2d', { willReadFrequently: true });
      bx.fillStyle = '#fff';
      bx.fillRect(0, 0, W, H);          // 투명 배경을 흰색으로
      bx.drawImage(bmp, 0, 0);
      var rgba = bx.getImageData(0, 0, W, H).data;

      // 그레이스케일 (Rec.601 luma — PIL 'L' 변환과 동일)
      var grey = new Uint8ClampedArray(W * H);
      for (var i = 0, p = 0; i < grey.length; i++, p += 4) {
        grey[i] = (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) | 0;
      }

      // 색 반전 휴리스틱: 어두운 픽셀이 더 많으면(흰 글씨/검은 배경) 반전해 흑자/백지로
      var hist = new Array(256);
      for (var h = 0; h < 256; h++) hist[h] = 0;
      for (var g = 0; g < grey.length; g++) hist[grey[g]]++;
      var dark = 0, light = 0;
      for (var v = 0; v < 200; v++) dark += hist[v];
      for (var w = 200; w < 256; w++) light += hist[w];
      if (dark >= light) {
        for (var r = 0; r < grey.length; r++) grey[r] = 255 - grey[r];
      }

      // 여백 크롭: 정규화 값 < 200 인 픽셀(=내용)의 경계 상자
      var mn = 255, mx = 0;
      for (var a = 0; a < grey.length; a++) { if (grey[a] < mn) mn = grey[a]; if (grey[a] > mx) mx = grey[a]; }
      var cropX = 0, cropY = 0, cropW = W, cropH = H;
      if (mx !== mn) {
        var minX = W, minY = H, maxX = 0, maxY = 0, found = false;
        var range = mx - mn;
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            var nrm = ((grey[y * W + x] - mn) / range) * 255;
            if (nrm < 200) {
              found = true;
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        if (found && maxX >= minX && maxY >= minY) {
          cropX = minX; cropY = minY;
          cropW = Math.max(1, maxX - minX);
          cropH = Math.max(1, maxY - minY);
        }
      }

      // 크롭 영역을 캔버스에 그린다
      var crop = document.createElement('canvas');
      crop.width = cropW; crop.height = cropH;
      var cx = crop.getContext('2d');
      var cropData = cx.createImageData(cropW, cropH);
      for (var cy = 0; cy < cropH; cy++) {
        for (var cxp = 0; cxp < cropW; cxp++) {
          var gv = grey[(cropY + cy) * W + (cropX + cxp)];
          var di = (cy * cropW + cxp) * 4;
          cropData.data[di] = cropData.data[di + 1] = cropData.data[di + 2] = gv;
          cropData.data[di + 3] = 255;
        }
      }
      cx.putImageData(cropData, 0, 0);

      // 384x384 안에 비율 유지로 축소 후 중앙 배치 (나머지는 0=검정 패딩)
      var scale = OCR_SIZE / Math.min(cropH, cropW);
      var newW = Math.round(cropW * scale), newH = Math.round(cropH * scale);
      if (newW > OCR_SIZE || newH > OCR_SIZE) {
        var ratio = Math.min(OCR_SIZE / newW, OCR_SIZE / newH);
        newW = Math.round(newW * ratio); newH = Math.round(newH * ratio);
      }
      newW = Math.max(1, newW); newH = Math.max(1, newH);
      var padW = Math.floor((OCR_SIZE - newW) / 2);
      var padH = Math.floor((OCR_SIZE - newH) / 2);

      var fin = document.createElement('canvas');
      fin.width = OCR_SIZE; fin.height = OCR_SIZE;
      var fx = fin.getContext('2d', { willReadFrequently: true });
      fx.fillStyle = '#000';
      fx.fillRect(0, 0, OCR_SIZE, OCR_SIZE);
      fx.imageSmoothingEnabled = true;
      fx.imageSmoothingQuality = 'high';
      fx.drawImage(crop, padW, padH, newW, newH);
      var finData = fx.getImageData(0, 0, OCR_SIZE, OCR_SIZE).data;

      var arr = new Float32Array(OCR_SIZE * OCR_SIZE);
      for (var k = 0, q = 0; k < arr.length; k++, q += 4) {
        arr[k] = (finData[q] / 255 - UNIMER_MEAN) / UNIMER_STD; // R채널 = grey
      }
      return arr;
    });
  }

