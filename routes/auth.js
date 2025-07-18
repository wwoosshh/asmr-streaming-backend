const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// 토큰 검증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: '토큰이 필요합니다.' });
  }
  
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'JWT 설정이 올바르지 않습니다.' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: '유효하지 않은 토큰입니다.' });
    }
    req.user = user;
    next();
  });
};

// 회원가입
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // 입력 검증
    if (!username || !email || !password) {
      return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }
    
    // 이메일 중복 확인
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 이메일 또는 사용자명입니다.' });
    }
    
    // 비밀번호 해시화
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // 사용자 생성
    const [result] = await pool.execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email, passwordHash]
    );
    
    res.status(201).json({ 
      message: '회원가입이 완료되었습니다.',
      userId: result.insertId 
    });
    
  } catch (error) {
    console.error('회원가입 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 로그인
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    }
    
    // 사용자 찾기
    const [users] = await pool.execute(
      'SELECT id, username, email, password_hash, role FROM users WHERE email = ?',
      [email]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 잘못되었습니다.' });
    }
    
    const user = users[0];
    
    // 비밀번호 확인
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 잘못되었습니다.' });
    }
    
    // JWT_SECRET 확인
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'JWT 설정이 올바르지 않습니다.' });
    }
    
    // JWT 토큰 생성
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      message: '로그인 성공',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('로그인 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 현재 사용자 정보 조회
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, username, email, role, created_at FROM users WHERE id = ?',
      [req.user.userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    
    res.json(users[0]);
  } catch (error) {
    console.error('사용자 정보 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 테스트용 라우트
router.get('/test', (req, res) => {
  res.json({ message: 'Auth 라우터가 정상적으로 작동합니다.' });
});

// 안전한 export 방식
module.exports = router;