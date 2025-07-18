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

// 라우트 연결
const contentsRouter = require('./routes/contents');
const audioRouter = require('./routes/audio');

app.use('/api/contents', contentsRouter);
app.use('/api/audio', audioRouter);

// 기본 라우트
app.get('/', (req, res) => {
  res.json({ message: 'ASMR Streaming API Server' });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});