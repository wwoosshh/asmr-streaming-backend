const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// ID를 8자리로 패딩하는 함수
function padId(id) {
  return id.toString().padStart(8, '0');
}

// 가능한 ID 패턴을 생성하는 함수
function generateIdPatterns(contentId) {
  const originalId = contentId.toString();
  const paddedId = padId(contentId);
  
  const patterns = new Set([originalId, paddedId]);
  return Array.from(patterns);
}

// 실제 컨텐츠 디렉토리를 찾는 함수
function findContentDirectory(contentId) {
  const baseDir = path.join(__dirname, '../../audio-files');
  const idPatterns = generateIdPatterns(contentId);
  
  console.log(`[디렉토리 찾기] contentId: ${contentId}, 패턴들: ${idPatterns.join(', ')}`);
  
  for (const pattern of idPatterns) {
    const dirPath = path.join(baseDir, `content-${pattern}`);
    console.log(`[디렉토리 확인] ${dirPath}`);
    if (fs.existsSync(dirPath)) {
      console.log(`[디렉토리 발견] ${dirPath}`);
      return dirPath;
    }
  }
  
  try {
    const allDirs = fs.readdirSync(baseDir).filter(item => {
      const fullPath = path.join(baseDir, item);
      return fs.statSync(fullPath).isDirectory() && item.startsWith('content-');
    });
    console.log(`[사용 가능한 디렉토리들] ${allDirs.join(', ')}`);
  } catch (error) {
    console.log(`[디렉토리 목록 읽기 오류] ${error.message}`);
  }
  
  return null;
}

// 파일을 찾는 함수
function findFileInDirectory(dirPath, contentId, fileNumber = null, extensions = ['.m4a', '.mp3']) {
  const idPatterns = generateIdPatterns(contentId);
  const allPatterns = [];
  
  for (const idPattern of idPatterns) {
    for (const ext of extensions) {
      if (fileNumber === null || fileNumber === 'full' || fileNumber === undefined) {
        allPatterns.push(`${idPattern}${ext}`);
      } else {
        allPatterns.push(`${idPattern}_${fileNumber}${ext}`);
      }
    }
  }
  
  console.log(`[파일 찾기] 디렉토리: ${dirPath}, 패턴들: ${allPatterns.join(', ')}`);
  
  for (const pattern of allPatterns) {
    const filePath = path.join(dirPath, pattern);
    console.log(`[파일 확인] ${filePath}`);
    if (fs.existsSync(filePath)) {
      console.log(`[파일 발견] ${filePath}`);
      return filePath;
    }
  }
  
  return null;
}

// 오디오 파일 서빙 함수
function serveAudioFile(req, res, filePath) {
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    console.log(`[파일 정보] 크기: ${fileSize} bytes, Range 요청: ${range ? 'Yes' : 'No'}`);
    
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

// 라우트 정의 (구체적인 것부터 일반적인 것 순서로)

// 이미지 관련 라우트들
router.get('/images/:contentId', (req, res) => {
  const contentId = req.params.contentId;
  
  console.log(`[이미지 목록 요청] contentId: ${contentId}`);
  
  if (!contentId) {
    return res.status(400).json({ error: '잘못된 요청 파라미터입니다.' });
  }
  
  const dirPath = findContentDirectory(contentId);
  if (!dirPath) {
    return res.status(404).json({ 
      error: '컨텐츠 디렉토리를 찾을 수 없습니다.',
      contentId: contentId
    });
  }
  
  try {
    const files = fs.readdirSync(dirPath);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    const idPatterns = generateIdPatterns(contentId);
    
    const images = [];
    
    // 메인 섬네일 찾기
    for (const idPattern of idPatterns) {
      for (const ext of imageExtensions) {
        const mainImageName = `${idPattern}${ext}`;
        if (files.includes(mainImageName)) {
          images.push({
            index: 0,
            filename: mainImageName,
            isMain: true,
            url: `/api/audio/image-main/${contentId}`
          });
          break;
        }
      }
      if (images.length > 0) break;
    }
    
    // 추가 이미지들 찾기
    let imageIndex = 1;
    while (true) {
      let found = false;
      for (const idPattern of idPatterns) {
        for (const ext of imageExtensions) {
          const imageName = `${idPattern}_${imageIndex}${ext}`;
          if (files.includes(imageName)) {
            images.push({
              index: imageIndex,
              filename: imageName,
              isMain: false,
              url: `/api/audio/image-part/${contentId}/${imageIndex}`
            });
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) break;
      imageIndex++;
    }
    
    console.log(`[이미지 목록] ${images.length}개 발견:`, images.map(img => img.filename));
    
    res.json({
      contentId: contentId,
      totalImages: images.length,
      images: images
    });
    
  } catch (error) {
    console.error(`[이미지 목록 조회 오류] ${error.message}`);
    res.status(500).json({ error: '이미지 목록을 조회하는 중 오류가 발생했습니다.' });
  }
});

router.get('/image-part/:contentId/:imageNumber', (req, res) => {
  const { contentId, imageNumber } = req.params;
  
  console.log(`[특정 이미지 요청] contentId: ${contentId}, imageNumber: ${imageNumber}`);
  
  if (!contentId || !imageNumber) {
    return res.status(400).json({ error: '잘못된 요청 파라미터입니다.' });
  }
  
  const dirPath = findContentDirectory(contentId);
  if (!dirPath) {
    return res.status(404).json({ 
      error: '컨텐츠 디렉토리를 찾을 수 없습니다.',
      contentId: contentId
    });
  }
  
  const imagePath = findFileInDirectory(dirPath, contentId, imageNumber, ['.jpg', '.jpeg', '.png', '.webp']);
  if (!imagePath) {
    try {
      const files = fs.readdirSync(dirPath);
      console.log(`[디렉토리 이미지 파일 목록] ${files.join(', ')}`);
    } catch (error) {
      console.log(`[디렉토리 읽기 오류] ${error.message}`);
    }
    
    return res.status(404).json({ 
      error: '이미지를 찾을 수 없습니다.',
      contentId: contentId,
      imageNumber: imageNumber,
      directory: dirPath
    });
  }
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(imagePath));
});

router.get('/image-main/:contentId', (req, res) => {
  const contentId = req.params.contentId;
  
  console.log(`[메인 이미지 요청] contentId: ${contentId}`);
  
  if (!contentId) {
    return res.status(400).json({ error: '잘못된 요청 파라미터입니다.' });
  }
  
  const dirPath = findContentDirectory(contentId);
  if (!dirPath) {
    return res.status(404).json({ 
      error: '컨텐츠 디렉토리를 찾을 수 없습니다.',
      contentId: contentId
    });
  }
  
  const imagePath = findFileInDirectory(dirPath, contentId, null, ['.jpg', '.jpeg', '.png', '.webp']);
  if (!imagePath) {
    try {
      const files = fs.readdirSync(dirPath);
      console.log(`[디렉토리 이미지 파일 목록] ${files.join(', ')}`);
    } catch (error) {
      console.log(`[디렉토리 읽기 오류] ${error.message}`);
    }
    
    return res.status(404).json({ 
      error: '메인 이미지를 찾을 수 없습니다.',
      contentId: contentId,
      directory: dirPath
    });
  }
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(imagePath));
});

// 오디오 관련 라우트들
router.get('/audio-full/:contentId', (req, res) => {
  const contentId = req.params.contentId;
  
  console.log(`[전체 오디오 요청] contentId: ${contentId}`);
  
  if (!contentId) {
    return res.status(400).json({ error: '잘못된 요청 파라미터입니다.' });
  }
  
  const dirPath = findContentDirectory(contentId);
  if (!dirPath) {
    return res.status(404).json({ 
      error: '컨텐츠 디렉토리를 찾을 수 없습니다.',
      contentId: contentId
    });
  }
  
  const filePath = findFileInDirectory(dirPath, contentId, 'full', ['.m4a', '.mp3', '.wav', '.aac']);
  if (!filePath) {
    try {
      const files = fs.readdirSync(dirPath);
      console.log(`[디렉토리 파일 목록] ${files.join(', ')}`);
    } catch (error) {
      console.log(`[디렉토리 읽기 오류] ${error.message}`);
    }
    
    return res.status(404).json({ 
      error: '전체 음성 파일을 찾을 수 없습니다.',
      contentId: contentId,
      directory: dirPath
    });
  }
  
  serveAudioFile(req, res, filePath);
});

router.get('/audio-part/:contentId/:partNumber', (req, res) => {
  const { contentId, partNumber } = req.params;
  
  console.log(`[파트 오디오 요청] contentId: ${contentId}, partNumber: ${partNumber}`);
  
  if (!contentId || !partNumber) {
    return res.status(400).json({ error: '잘못된 요청 파라미터입니다.' });
  }
  
  const dirPath = findContentDirectory(contentId);
  if (!dirPath) {
    return res.status(404).json({ 
      error: '컨텐츠 디렉토리를 찾을 수 없습니다.',
      contentId: contentId
    });
  }
  
  const filePath = findFileInDirectory(dirPath, contentId, partNumber, ['.m4a', '.mp3', '.wav', '.aac']);
  if (!filePath) {
    try {
      const files = fs.readdirSync(dirPath);
      console.log(`[디렉토리 파일 목록] ${files.join(', ')}`);
    } catch (error) {
      console.log(`[디렉토리 읽기 오류] ${error.message}`);
    }
    
    return res.status(404).json({ 
      error: '음성 파일을 찾을 수 없습니다.',
      contentId: contentId,
      partNumber: partNumber,
      directory: dirPath
    });
  }
  
  serveAudioFile(req, res, filePath);
});

// 디버그 라우트
router.get('/debug/:contentId', (req, res) => {
  const contentId = req.params.contentId;
  
  if (!contentId) {
    return res.status(400).json({ error: '잘못된 요청 파라미터입니다.' });
  }
  
  const dirPath = findContentDirectory(contentId);
  
  if (!dirPath) {
    return res.status(404).json({ 
      error: '컨텐츠 디렉토리를 찾을 수 없습니다.',
      contentId: contentId
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
      fileCount: files.length,
      idPatterns: generateIdPatterns(contentId)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 레거시 리다이렉트 라우트 (메인 이미지)
router.get('/image/:contentId', (req, res) => {
  const contentId = req.params.contentId;
  res.redirect(`/api/audio/image-main/${contentId}`);
});

module.exports = router;