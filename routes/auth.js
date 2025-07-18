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

// 관리자 권한 확인 미들웨어
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  next();
};

// 이메일 유효성 검사
const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

// 비밀번호 유효성 검사
const validatePassword = (password) => {
  return password && password.length >= 6;
};

// 테스트용 라우트
router.get('/test', (req, res) => {
  res.json({ message: 'Auth 라우터가 정상적으로 작동합니다.' });
});

// 회원가입
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;
    
    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }
    
    if (password !== confirmPassword) {
      return res.status(400).json({ error: '비밀번호가 일치하지 않습니다.' });
    }
    
    if (!validateEmail(email)) {
      return res.status(400).json({ error: '유효하지 않은 이메일 형식입니다.' });
    }
    
    if (!validatePassword(password)) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
    }
    
    if (username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: '사용자명은 2-20자 사이여야 합니다.' });
    }
    
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 이메일 또는 사용자명입니다.' });
    }
    
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    const [result] = await pool.execute(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, passwordHash, 'user']
    );
    
    console.log(`[회원가입] 새 사용자 생성: ${username} (${email})`);
    
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
    
    const [users] = await pool.execute(
      'SELECT id, username, email, password_hash, role FROM users WHERE email = ?',
      [email]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 잘못되었습니다.' });
    }
    
    const user = users[0];
    
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 잘못되었습니다.' });
    }
    
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'JWT 설정이 올바르지 않습니다.' });
    }
    
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role,
        username: user.username
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log(`[로그인] 사용자 로그인: ${user.username} (${user.role})`);
    
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

// 관리자 전용: 모든 사용자 조회
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const [countResult] = await pool.execute('SELECT COUNT(*) as total FROM users');
    const total = countResult[0].total;
    
    const [users] = await pool.execute(
      `SELECT id, username, email, role, created_at 
       FROM users 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    
    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('사용자 목록 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 관리자 전용: 사용자 권한 변경 (안전한 패턴으로 수정)
router.patch('/user-role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId, role } = req.body;
    
    if (!userId || !role) {
      return res.status(400).json({ error: 'userId와 role을 모두 제공해야 합니다.' });
    }
    
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: '유효하지 않은 권한입니다.' });
    }
    
    if (parseInt(userId) === req.user.userId) {
      return res.status(400).json({ error: '자신의 권한은 변경할 수 없습니다.' });
    }
    
    await pool.execute(
      'UPDATE users SET role = ? WHERE id = ?',
      [role, userId]
    );
    
    console.log(`[권한 변경] 사용자 ID ${userId}의 권한을 ${role}로 변경`);
    
    res.json({ message: '권한이 변경되었습니다.' });
  } catch (error) {
    console.error('권한 변경 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 비밀번호 변경
router.patch('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }
    
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: '새 비밀번호가 일치하지 않습니다.' });
    }
    
    if (!validatePassword(newPassword)) {
      return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });
    }
    
    const [users] = await pool.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user.userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, users[0].password_hash);
    
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }
    
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
    
    await pool.execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newPasswordHash, req.user.userId]
    );
    
    console.log(`[비밀번호 변경] 사용자 ID ${req.user.userId} 비밀번호 변경`);
    
    res.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (error) {
    console.error('비밀번호 변경 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;

// 미들웨어들을 별도로 export
module.exports.authenticateToken = authenticateToken;
module.exports.requireAdmin = requireAdmin;