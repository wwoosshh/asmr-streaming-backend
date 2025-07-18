const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('./auth');

// 특정 컨텐츠의 댓글 목록 조회
router.get('/content/:contentId', async (req, res) => {
  try {
    const contentId = req.params.contentId;
    
    if (!contentId || isNaN(contentId)) {
      return res.status(400).json({ error: '유효하지 않은 컨텐츠 ID입니다.' });
    }
    
    console.log('[댓글 목록] 컨텐츠 ID:', contentId);
    
    // 컨텐츠 존재 확인
    const [contentExists] = await pool.execute(
      'SELECT id FROM contents WHERE id = ?',
      [contentId]
    );
    
    if (contentExists.length === 0) {
      return res.status(404).json({ error: '컨텐츠를 찾을 수 없습니다.' });
    }
    
    // 댓글 조회
    const [comments] = await pool.execute(`
      SELECT 
        c.id, c.comment_text, c.created_at,
        u.id as user_id, u.username
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.content_id = ?
      ORDER BY c.created_at DESC
    `, [contentId]);
    
    console.log(`[댓글 목록] ${comments.length}개 댓글 조회됨`);
    
    res.json({
      contentId: parseInt(contentId),
      comments: comments
    });
    
  } catch (error) {
    console.error('댓글 목록 조회 오류:', error);
    res.status(500).json({ 
      error: '댓글 목록 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 댓글 작성 (로그인 필요)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { contentId, commentText } = req.body;
    const userId = req.user.userId;
    
    if (!contentId || !commentText) {
      return res.status(400).json({ error: '컨텐츠 ID와 댓글 내용은 필수입니다.' });
    }
    
    if (commentText.trim().length < 1) {
      return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });
    }
    
    if (commentText.length > 1000) {
      return res.status(400).json({ error: '댓글은 1000자 이내로 작성해주세요.' });
    }
    
    console.log('[댓글 작성] 사용자:', req.user.username, '컨텐츠:', contentId);
    
    // 컨텐츠 존재 확인
    const [contentExists] = await pool.execute(
      'SELECT id, title FROM contents WHERE id = ?',
      [contentId]
    );
    
    if (contentExists.length === 0) {
      return res.status(404).json({ error: '컨텐츠를 찾을 수 없습니다.' });
    }
    
    // 댓글 작성
    const [result] = await pool.execute(
      'INSERT INTO comments (content_id, user_id, comment_text) VALUES (?, ?, ?)',
      [contentId, userId, commentText.trim()]
    );
    
    // 작성된 댓글 정보 조회
    const [newComment] = await pool.execute(`
      SELECT 
        c.id, c.comment_text, c.created_at,
        u.id as user_id, u.username
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [result.insertId]);
    
    console.log(`[댓글 작성] 완료: ID ${result.insertId}, 컨텐츠: ${contentExists[0].title}`);
    
    res.status(201).json({
      message: '댓글이 작성되었습니다.',
      comment: newComment[0]
    });
    
  } catch (error) {
    console.error('댓글 작성 오류:', error);
    res.status(500).json({ 
      error: '댓글 작성 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 댓글 수정 (본인만 가능)
router.patch('/:commentId', authenticateToken, async (req, res) => {
  try {
    const commentId = req.params.commentId;
    const { commentText } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    if (!commentText) {
      return res.status(400).json({ error: '댓글 내용은 필수입니다.' });
    }
    
    if (commentText.trim().length < 1) {
      return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });
    }
    
    if (commentText.length > 1000) {
      return res.status(400).json({ error: '댓글은 1000자 이내로 작성해주세요.' });
    }
    
    console.log('[댓글 수정] 댓글 ID:', commentId, '사용자:', req.user.username);
    
    // 댓글 존재 및 권한 확인
    const [existing] = await pool.execute(
      'SELECT id, user_id, comment_text FROM comments WHERE id = ?',
      [commentId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
    }
    
    // 본인 댓글이거나 관리자인지 확인
    if (existing[0].user_id !== userId && userRole !== 'admin') {
      return res.status(403).json({ error: '본인의 댓글만 수정할 수 있습니다.' });
    }
    
    // 댓글 수정
    await pool.execute(
      'UPDATE comments SET comment_text = ? WHERE id = ?',
      [commentText.trim(), commentId]
    );
    
    // 수정된 댓글 정보 조회
    const [updatedComment] = await pool.execute(`
      SELECT 
        c.id, c.comment_text, c.created_at,
        u.id as user_id, u.username
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [commentId]);
    
    console.log(`[댓글 수정] 완료: ID ${commentId}`);
    
    res.json({
      message: '댓글이 수정되었습니다.',
      comment: updatedComment[0]
    });
    
  } catch (error) {
    console.error('댓글 수정 오류:', error);
    res.status(500).json({ 
      error: '댓글 수정 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 댓글 삭제 (본인 또는 관리자만 가능)
router.delete('/:commentId', authenticateToken, async (req, res) => {
  try {
    const commentId = req.params.commentId;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    console.log('[댓글 삭제] 댓글 ID:', commentId, '사용자:', req.user.username);
    
    // 댓글 존재 및 권한 확인
    const [existing] = await pool.execute(
      'SELECT id, user_id, comment_text FROM comments WHERE id = ?',
      [commentId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
    }
    
    // 본인 댓글이거나 관리자인지 확인
    if (existing[0].user_id !== userId && userRole !== 'admin') {
      return res.status(403).json({ error: '본인의 댓글만 삭제할 수 있습니다.' });
    }
    
    // 댓글 삭제
    await pool.execute(
      'DELETE FROM comments WHERE id = ?',
      [commentId]
    );
    
    console.log(`[댓글 삭제] 완료: ID ${commentId}`);
    
    res.json({ message: '댓글이 삭제되었습니다.' });
    
  } catch (error) {
    console.error('댓글 삭제 오류:', error);
    res.status(500).json({ 
      error: '댓글 삭제 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 사용자별 댓글 목록 조회
router.get('/user/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: '유효하지 않은 사용자 ID입니다.' });
    }
    
    console.log('[사용자 댓글] 사용자 ID:', userId, 'page:', page);
    
    // 사용자 존재 확인
    const [userExists] = await pool.execute(
      'SELECT id, username FROM users WHERE id = ?',
      [userId]
    );
    
    if (userExists.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    
    // 전체 댓글 수
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM comments WHERE user_id = ?',
      [userId]
    );
    
    // 댓글 목록 조회
    const [comments] = await pool.execute(`
      SELECT 
        c.id, c.comment_text, c.created_at,
        cont.id as content_id, cont.title as content_title
      FROM comments c
      JOIN contents cont ON c.content_id = cont.id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);
    
    console.log(`[사용자 댓글] ${comments.length}개 댓글 조회됨`);
    
    res.json({
      user: userExists[0],
      comments: comments,
      pagination: {
        page,
        limit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });
    
  } catch (error) {
    console.error('사용자 댓글 조회 오류:', error);
    res.status(500).json({ 
      error: '사용자 댓글 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

module.exports = router;