const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5159;

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 라우트 연결 (안전한 방식으로 수정)
try {
  const contentsRouter = require('./routes/contents');
  const audioRouter = require('./routes/audio');
  
  // auth 라우터 안전하게 가져오기
  let authRouter;
  try {
    const authModule = require('./routes/auth');
    authRouter = authModule.router || authModule;
  } catch (authError) {
    console.error('Auth 라우터 로딩 오류:', authError.message);
    // 임시 auth 라우터 생성
    authRouter = express.Router();
    authRouter.get('/', (req, res) => {
      res.json({ error: 'Auth 기능이 현재 사용할 수 없습니다.' });
    });
  }
  
  app.use('/api/contents', contentsRouter);
  app.use('/api/audio', audioRouter);
  app.use('/api/auth', authRouter);
  
} catch (error) {
  console.error('라우터 로딩 오류:', error);
  process.exit(1);
}

// 기본 라우트
app.get('/', (req, res) => {
  res.json({ message: 'ASMR Streaming API Server' });
});

// 404 에러 처리
app.use((req, res) => {
  console.log(`404 요청: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
});

// 전역 에러 처리
app.use((error, req, res, next) => {
  console.error('서버 에러:', error);
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`API 주소: http://localhost:${PORT}`);
});