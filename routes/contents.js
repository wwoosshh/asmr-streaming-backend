const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// 모든 컨텐츠 조회
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        id, title, description, profile_image_url, 
        content_rating, duration_minutes, total_files,
        view_count, like_count, created_at 
      FROM contents 
      ORDER BY created_at DESC
    `);
    
    res.json(rows);
  } catch (error) {
    console.error('컨텐츠 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 컨텐츠 검색 (구체적인 라우트를 먼저 정의)
router.get('/search/:query', async (req, res) => {
  try {
    const searchQuery = req.params.query;
    
    if (!searchQuery || searchQuery.trim().length === 0) {
      return res.status(400).json({ error: '검색어를 입력해주세요.' });
    }
    
    const query = `%${searchQuery}%`;
    
    const [rows] = await pool.execute(`
      SELECT 
        id, title, description, profile_image_url, 
        content_rating, duration_minutes, total_files,
        view_count, like_count, created_at 
      FROM contents 
      WHERE title LIKE ? OR description LIKE ?
      ORDER BY created_at DESC
    `, [query, query]);
    
    res.json(rows);
  } catch (error) {
    console.error('컨텐츠 검색 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 특정 컨텐츠 상세 조회
router.get('/detail/:id', async (req, res) => {
  try {
    const contentId = req.params.id;
    
    if (!contentId || isNaN(contentId)) {
      return res.status(400).json({ error: '유효하지 않은 컨텐츠 ID입니다.' });
    }
    
    const [rows] = await pool.execute(`
      SELECT * FROM contents WHERE id = ?
    `, [contentId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: '컨텐츠를 찾을 수 없습니다.' });
    }
    
    // 해당 컨텐츠의 태그들도 가져오기
    const [tags] = await pool.execute(`
      SELECT t.name, t.category 
      FROM tags t 
      JOIN content_tags ct ON t.id = ct.tag_id 
      WHERE ct.content_id = ?
    `, [contentId]);
    
    const content = rows[0];
    content.tags = tags;
    
    res.json(content);
  } catch (error) {
    console.error('컨텐츠 상세 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ID로 컨텐츠 조회 (숫자 ID만 허용, 가장 일반적인 라우트는 마지막에)
router.get('/:id', async (req, res) => {
  const contentId = req.params.id;
  
  // 숫자가 아닌 경우 404 처리
  if (isNaN(contentId)) {
    return res.status(404).json({ error: '잘못된 요청입니다.' });
  }
  
  // detail 라우트로 리다이렉트
  res.redirect(`/api/contents/detail/${contentId}`);
});

module.exports = router;