const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5159;

// 모든 preflight OPTIONS 요청을 먼저 처리
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

// 모든 응답에 CORS 헤더 추가
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // 보안 헤더들
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  
  next();
});

// JSON 파싱 미들웨어
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.method === 'OPTIONS') {
    console.log('  ↳ CORS Preflight 요청');
  }
  next();
});

// 정적 파일 서빙 (uploads 디렉토리)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 라우트 import
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const audioRoutes = require('./routes/audio');
const contentsRoutes = require('./routes/contents');
const tagsRoutes = require('./routes/tags');
const commentsRoutes = require('./routes/comments');
const debugRoutes = require('./routes/debug');

// API 라우트 등록
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api/contents', contentsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/debug', debugRoutes);

// 서버 상태 확인 라우트
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: process.env.DB_NAME || 'asmr_db',
    protocol: 'HTTPS',
    cors: 'enabled'
  });
});

// 루트 경로
app.get('/', (req, res) => {
  res.json({ 
    message: 'ASMR API Server (HTTPS)',
    version: '1.0.0',
    cors: 'All origins allowed',
    endpoints: [
      'GET /api/health - 서버 상태 확인',
      'GET /api/debug/db-test - DB 연결 테스트',
      'GET /api/debug/db-structure - DB 구조 확인',
      'POST /api/auth/register - 회원가입',
      'POST /api/auth/login - 로그인',
      'GET /api/contents - 컨텐츠 목록',
      'GET /api/contents/detail/:id - 컨텐츠 상세',
      'GET /api/tags - 태그 목록',
      'GET /api/comments/content/:id - 댓글 목록',
      'POST /api/comments - 댓글 작성',
      'GET /api/admin/stats - 관리자 통계'
    ]
  });
});

// 글로벌 오류 처리 미들웨어
app.use((error, req, res, next) => {
  console.error('=== 서버 오류 발생 ===');
  console.error('시간:', new Date().toISOString());
  console.error('경로:', req.method, req.path);
  console.error('오류:', error.message);
  console.error('스택:', error.stack);
  console.error('========================');
  
  // CORS 헤더 추가 (오류 응답에도)
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
  
  // 데이터베이스 관련 오류 체크
  if (error.code === 'ER_NO_SUCH_TABLE') {
    return res.status(500).json({ 
      error: '데이터베이스 테이블이 존재하지 않습니다.',
      table: error.sqlMessage,
      solution: '데이터베이스 스키마를 생성해주세요.'
    });
  }
  
  if (error.code === 'ECONNREFUSED') {
    return res.status(500).json({ 
      error: '데이터베이스 연결 실패',
      solution: 'MySQL 서버가 실행 중인지 확인하고 .env 설정을 확인해주세요.'
    });
  }
  
  if (error.code === 'ER_ACCESS_DENIED_ERROR') {
    return res.status(500).json({ 
      error: '데이터베이스 접근 권한 오류',
      solution: 'MySQL 사용자 권한을 확인해주세요.'
    });
  }
  
  if (error.code === 'ER_BAD_DB_ERROR') {
    return res.status(500).json({ 
      error: '데이터베이스가 존재하지 않습니다.',
      solution: 'asmr_db 데이터베이스를 생성해주세요.'
    });
  }
  
  res.status(500).json({ 
    error: '서버 내부 오류',
    message: error.message,
    ...(process.env.NODE_ENV === 'development' && { 
      stack: error.stack,
      path: req.path,
      method: req.method
    })
  });
});

// 404 처리
app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.path} - 경로를 찾을 수 없음`);
  
  // CORS 헤더 추가 (404 응답에도)
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
  
  res.status(404).json({ 
    error: '요청한 경로를 찾을 수 없습니다.',
    path: req.path,
    availableEndpoints: [
      '/api/health',
      '/api/debug/db-test',
      '/api/debug/db-structure',
      '/api/auth/*',
      '/api/contents/*',
      '/api/tags/*',
      '/api/comments/*',
      '/api/admin/*',
      '/api/audio/*'
    ]
  });
});

// HTTPS 서버 시작
try {
  const privateKey = fs.readFileSync(path.join(__dirname, 'ssl', 'private-key.pem'), 'utf8');
  const certificate = fs.readFileSync(path.join(__dirname, 'ssl', 'certificate.pem'), 'utf8');
  
  const credentials = { 
    key: privateKey, 
    cert: certificate,
    requestCert: false,
    rejectUnauthorized: false
  };
  
  https.createServer(credentials, app).listen(PORT, '0.0.0.0', () => {
    console.log(`=== ASMR API 서버 시작 (HTTPS) ===`);
    console.log(`포트: ${PORT}`);
    console.log(`바인딩: 0.0.0.0 (모든 인터페이스)`);
    console.log(`CORS: 모든 도메인 허용`);
    console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
    console.log(`시간: ${new Date().toISOString()}`);
    console.log(`데이터베이스: ${process.env.DB_HOST}:3306/${process.env.DB_NAME}`);
    console.log(`로컬 테스트: https://localhost:${PORT}/api/health`);
    console.log(`외부 접근: https://58.233.102.165:${PORT}/api/health`);
    console.log('========================');
    
    // 서버 시작 후 자체 연결 테스트
    setTimeout(() => {
      console.log('\n🧪 서버 자체 연결 테스트 시작...');
      
      const testReq = https.request({
        hostname: 'localhost',
        port: PORT,
        path: '/api/health',
        method: 'GET',
        rejectUnauthorized: false
      }, (res) => {
        console.log('✅ localhost 테스트 성공:', res.statusCode);
      });
      testReq.on('error', (err) => {
        console.error('❌ localhost 테스트 실패:', err.message);
      });
      testReq.end();
    }, 2000);
  });
  
} catch (error) {
  console.error('SSL 인증서 로드 실패:', error.message);
  console.log('HTTP 모드로 실행합니다...');
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== ASMR API 서버 시작 (HTTP) ===`);
    console.log(`포트: ${PORT}`);
    console.log(`바인딩: 0.0.0.0 (모든 인터페이스)`);
    console.log(`CORS: 모든 도메인 허용`);
    console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
    console.log(`시간: ${new Date().toISOString()}`);
    console.log(`데이터베이스: ${process.env.DB_HOST}:3306/${process.env.DB_NAME}`);
    console.log(`테스트 URL: http://localhost:${PORT}/api/health`);
    console.log(`⚠️  HTTPS를 위해 SSL 인증서를 설정해주세요.`);
    console.log('========================');
  });
}

// 프로세스 종료 처리
process.on('SIGINT', () => {
  console.log('\n서버 종료 중...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('처리되지 않은 예외:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('처리되지 않은 Promise 거부:', reason);
  process.exit(1);
});