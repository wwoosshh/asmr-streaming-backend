const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// 음성 파일 스트리밍
router.get('/:contentId/:fileNumber', (req, res) => {
  const { contentId, fileNumber } = req.params;
  
  console.log(`[오디오 요청] contentId: ${contentId}, fileNumber: ${fileNumber}`);
  
  // 파라미터 검증
  if (!contentId || !fileNumber) {
    return res.status(400).json({ error: '잘못된 요청 파라미터입니다.' });
  }
  
  // 여러 파일명 패턴 시도
  let filePatterns = [];
  
  if (fileNumber === 'full') {
    // 전체 파일용 패턴들
    filePatterns = [
      `${contentId}.m4a`,           // 1424137.m4a
      `0${contentId}.m4a`,          // 01424137.m4a
      `${contentId}.mp3`,           // 1424137.mp3
      `0${contentId}.mp3`           // 01424137.mp3
    ];
  } else {
    // 파트 파일용 패턴들
    filePatterns = [
      `${contentId}_${fileNumber}.m4a`,     // 1424137_1.m4a
      `0${contentId}_${fileNumber}.m4a`,    // 01424137_1.m4a
      `${contentId}_${fileNumber}.mp3`,     // 1424137_1.mp3
      `0${contentId}_${fileNumber}.mp3`     // 01424137_1.mp3
    ];
  }
  
  const dirPath = path.join(__dirname, '../../audio-files/content-' + contentId);
  console.log(`[디렉토리 경로] ${dirPath}`);
  
  // 디렉토리 존재 확인
  if (!fs.existsSync(dirPath)) {
    console.log(`[에러] 디렉토리를 찾을 수 없음: ${dirPath}`);
    return res.status(404).json({ 
      error: '컨텐츠 디렉토리를 찾을 수 없습니다.',
      directory: dirPath
    });
  }
  
  // 패턴별로 파일 찾기
  let foundFilePath = null;
  for (const pattern of filePatterns) {
    const testPath = path.join(dirPath, pattern);
    console.log(`[파일 확인] ${testPath}`);
    if (fs.existsSync(testPath)) {
      foundFilePath = testPath;
      console.log(`[파일 발견] ${foundFilePath}`);
      break;
    }
  }
  
  if (!foundFilePath) {
    // 디렉토리에 실제로 어떤 파일들이 있는지 확인
    try {
      const files = fs.readdirSync(dirPath);
      console.log(`[디렉토리 파일 목록] ${files.join(', ')}`);
    } catch (error) {
      console.log(`[디렉토리 읽기 오류] ${error.message}`);
    }
    
    return res.status(404).json({ 
      error: '음성 파일을 찾을 수 없습니다.',
      contentId: contentId,
      fileNumber: fileNumber,
      searchedPatterns: filePatterns
    });
  }
  
  serveAudioFile(req, res, foundFilePath);
});

// 오디오 파일 서빙 함수
function serveAudioFile(req, res, filePath) {
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    console.log(`[파일 정보] 크기: ${fileSize} bytes, Range 요청: ${range ? 'Yes' : 'No'}`);
    
    // MIME 타입 결정
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'audio/mpeg';
    switch (ext) {
      case '.m4a':
        contentType = 'audio/mp4';
        break;
      case '.mp3':
        contentType = 'audio/mpeg';
        break;
      case '.wav':
        contentType = 'audio/wav';
        break;
      case '.aac':
        contentType = 'audio/aac';
        break;
    }
    
    if (range) {
      // 범위 요청 처리 (스트리밍)
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      console.log(`[스트리밍] ${start}-${end}/${fileSize} (${chunksize} bytes)`);
      
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range'
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      // 전체 파일 전송
      console.log(`[전체 전송] ${fileSize} bytes`);
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error(`[파일 서빙 에러] ${error.message}`);
    res.status(500).json({ error: '파일 읽기 중 오류가 발생했습니다.' });
  }
}

// 프로필 이미지 제공
router.get('/image/:contentId', (req, res) => {
  const contentId = req.params.contentId;
  
  console.log(`[이미지 요청] contentId: ${contentId}`);
  
  // 파라미터 검증
  if (!contentId) {
    return res.status(400).json({ error: '잘못된 요청 파라미터입니다.' });
  }
  
  const dirPath = path.join(__dirname, '../../audio-files/content-' + contentId);
  
  // 여러 이미지 파일명 패턴 시도
  const imagePatterns = [
    `${contentId}.jpg`,           // 1424137.jpg
    `0${contentId}.jpg`,          // 01424137.jpg
    `${contentId}.jpeg`,          // 1424137.jpeg
    `0${contentId}.jpeg`,         // 01424137.jpeg
    `${contentId}.png`,           // 1424137.png
    `0${contentId}.png`,          // 01424137.png
    `${contentId}.webp`,          // 1424137.webp
    `0${contentId}.webp`          // 01424137.webp
  ];
  
  let foundImagePath = null;
  
  for (const pattern of imagePatterns) {
    const testPath = path.join(dirPath, pattern);
    console.log(`[이미지 확인] ${testPath}`);
    if (fs.existsSync(testPath)) {
      foundImagePath = testPath;
      console.log(`[이미지 발견] ${foundImagePath}`);
      break;
    }
  }
  
  if (!foundImagePath) {
    // 디렉토리에 실제로 어떤 파일들이 있는지 확인
    try {
      const files = fs.readdirSync(dirPath);
      console.log(`[디렉토리 이미지 파일 목록] ${files.join(', ')}`);
    } catch (error) {
      console.log(`[디렉토리 읽기 오류] ${error.message}`);
    }
    
    return res.status(404).json({ 
      error: '이미지를 찾을 수 없습니다.',
      contentId: contentId,
      searchedPatterns: imagePatterns
    });
  }
  
  // 이미지 전송
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // 1일 캐시
  res.sendFile(path.resolve(foundImagePath));
});

// 디버그용 파일 목록 조회
router.get('/debug/:contentId', (req, res) => {
  const contentId = req.params.contentId;
  
  if (!contentId) {
    return res.status(400).json({ error: '잘못된 요청 파라미터입니다.' });
  }
  
  const dirPath = path.join(__dirname, '../../audio-files/content-' + contentId);
  
  if (!fs.existsSync(dirPath)) {
    return res.status(404).json({ 
      error: '컨텐츠 디렉토리를 찾을 수 없습니다.',
      path: dirPath
    });
  }
  
  try {
    const files = fs.readdirSync(dirPath);
    const fileDetails = files.map(file => {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        isFile: stats.isFile(),
        extension: path.extname(file)
      };
    });
    
    res.json({
      contentId: contentId,
      directory: dirPath,
      files: fileDetails,
      fileCount: files.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;