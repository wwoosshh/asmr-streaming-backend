const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// 음성 파일 스트리밍
router.get('/:contentId/:fileNumber', (req, res) => {
  const { contentId, fileNumber } = req.params;
  
  console.log(`음성 파일 요청: contentId=${contentId}, fileNumber=${fileNumber}`);
  
  let fileName;
  if (fileNumber === 'full') {
    // 전체 파일 요청
    fileName = `${contentId}.m4a`;
  } else {
    // 파트 파일 요청
    fileName = `${contentId}_${fileNumber}.m4a`;
  }
  
  const filePath = path.join(__dirname, '../../audio-files/content-' + contentId, fileName);
  console.log(`시도 중: ${filePath}`);
  
  // 파일 존재 확인
  if (!fs.existsSync(filePath)) {
    console.log(`음성 파일을 찾을 수 없습니다: ${filePath}`);
    return res.status(404).json({ error: '음성 파일을 찾을 수 없습니다.' });
  }
  
  console.log(`파일 찾음: ${filePath}`);
  
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  
  const contentType = 'audio/mp4';
  
  if (range) {
    // 범위 요청 처리 (스트리밍용)
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    // 전체 파일 전송
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// 프로필 이미지 제공
router.get('/image/:contentId', (req, res) => {
  const contentId = req.params.contentId;
  
  console.log(`이미지 요청: contentId=${contentId}`);
  
  const possibleExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  let imagePath = null;
  
  for (const ext of possibleExtensions) {
    imagePath = path.join(__dirname, '../../audio-files/content-' + contentId, contentId + ext);
    console.log(`이미지 시도 중: ${imagePath}`);
    if (fs.existsSync(imagePath)) {
      console.log(`이미지 찾음: ${imagePath}`);
      break;
    }
    imagePath = null;
  }
  
  if (!imagePath) {
    console.log(`이미지를 찾을 수 없습니다: content-${contentId}`);
    return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
  }
  
  res.sendFile(path.resolve(imagePath));
});

module.exports = router;