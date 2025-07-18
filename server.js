const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5159;

// CORS 설정
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

// JSON 파싱 미들웨어
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 기본 라우트
app.get('/', (req, res) => {
  res.json({ 
    message: 'ASMR 스트리밍 서버가 실행 중입니다.',
    endpoints: {
      contents: '/api/contents',
      audio: '/api/audio',
      auth: '/api/auth',
      admin: '/api/admin'
    },
    version: '1.0.0'
  });
});

// 헬스 체크
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 라우터들을 안전하게 로드
try {
  const contentsRouter = require('./routes/contents');
  const audioRouter = require('./routes/audio');
  const authRouter = require('./routes/auth');
  const adminRouter = require('./routes/admin');

  // 라우터 연결
  app.use('/api/contents', contentsRouter);
  app.use('/api/audio', audioRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  
  console.log('✅ 모든 라우터가 성공적으로 로드되었습니다.');
} catch (error) {
  console.error('❌ 라우터 로드 중 오류 발생:', error.message);
  process.exit(1);
}

// 404 에러 처리
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: '요청한 엔드포인트를 찾을 수 없습니다.',
    path: req.originalUrl,
    method: req.method
  });
});

// 전역 에러 처리 미들웨어
app.use((error, req, res, next) => {
  console.error('서버 에러:', error);
  
  // Multer 에러 처리
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '파일 크기가 너무 큽니다. (최대 500MB)' });
  }
  
  if (error.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: '파일 개수가 너무 많습니다. (최대 20개)' });
  }
  
  if (error.message === '지원하지 않는 파일 형식입니다.') {
    return res.status(400).json({ error: error.message });
  }
  
  // JWT 에러 처리
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
  
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ error: '만료된 토큰입니다.' });
  }
  
  // 기본 에러 처리
  res.status(500).json({ 
    error: '서버 내부 오류가 발생했습니다.',
    message: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 서버가 http://localhost:${PORT}에서 실행 중입니다.`);
  console.log(`📁 오디오 파일 경로: ${path.join(__dirname, 'audio-files')}`);
  console.log(`📤 업로드 임시 경로: ${path.join(__dirname, 'uploads/temp')}`);
  console.log(`🔑 JWT Secret 설정: ${process.env.JWT_SECRET ? '✅' : '❌'}`);
  console.log(`💾 데이터베이스 설정: ${process.env.DB_NAME ? '✅' : '❌'}`);
  
  // 필요한 디렉토리 생성
  const fs = require('fs');
  const audioDir = path.join(__dirname, 'audio-files');
  const uploadDir = path.join(__dirname, 'uploads', 'temp');
  
  [audioDir, uploadDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 디렉토리 생성: ${dir}`);
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM 신호를 받았습니다. 서버를 종료합니다...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT 신호를 받았습니다. 서버를 종료합니다...');
  process.exit(0);
});

module.exports = app;