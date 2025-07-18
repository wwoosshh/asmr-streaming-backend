const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// 컨텐츠에 연결된 태그들을 가져오는 함수
const getContentTags = async (contentId) => {
  try {
    const [tags] = await pool.execute(`
      SELECT t.id, t.name, t.category 
      FROM tags t 
      JOIN content_tags ct ON t.id = ct.tag_id 
      WHERE ct.content_id = ?
      ORDER BY t.category, t.sort_order, t.name
    `, [contentId]);
    
    return tags;
  } catch (error) {
    console.error('태그 조회 오류:', error);
    return [];
  }
};

// 모든 컨텐츠 조회 (태그 정보 포함)
router.get('/', async (req, res) => {
  try {
    console.log('[컨텐츠 목록] 조회 시작');
    
    const [contents] = await pool.execute(`
      SELECT 
        id, title, description, profile_image_url, 
        content_rating, duration_minutes, total_files,
        view_count, like_count, created_at, updated_at
      FROM contents 
      ORDER BY created_at DESC
    `);
    
    console.log(`[컨텐츠 목록] ${contents.length}개 컨텐츠 조회됨`);
    
    // 각 컨텐츠에 태그 정보 추가
    for (const content of contents) {
      content.tags = await getContentTags(content.id);
    }
    
    res.json(contents);
  } catch (error) {
    console.error('컨텐츠 조회 오류:', error);
    res.status(500).json({ 
      error: '컨텐츠 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 컨텐츠 검색 (태그로도 검색 가능)
router.get('/search/:query', async (req, res) => {
  try {
    const searchQuery = req.params.query;
    
    if (!searchQuery || searchQuery.trim().length === 0) {
      return res.status(400).json({ error: '검색어를 입력해주세요.' });
    }
    
    console.log('[컨텐츠 검색] 검색어:', searchQuery);
    
    const query = `%${searchQuery}%`;
    
    // 제목, 설명, 태그명으로 검색
    const [contents] = await pool.execute(`
      SELECT DISTINCT
        c.id, c.title, c.description, c.profile_image_url, 
        c.content_rating, c.duration_minutes, c.total_files,
        c.view_count, c.like_count, c.created_at, c.updated_at
      FROM contents c
      LEFT JOIN content_tags ct ON c.id = ct.content_id
      LEFT JOIN tags t ON ct.tag_id = t.id
      WHERE c.title LIKE ? 
         OR c.description LIKE ?
         OR t.name LIKE ?
      ORDER BY c.created_at DESC
    `, [query, query, query]);
    
    console.log(`[컨텐츠 검색] ${contents.length}개 결과`);
    
    // 각 컨텐츠에 태그 정보 추가
    for (const content of contents) {
      content.tags = await getContentTags(content.id);
    }
    
    res.json(contents);
  } catch (error) {
    console.error('컨텐츠 검색 오류:', error);
    res.status(500).json({ 
      error: '컨텐츠 검색 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 특정 컨텐츠 상세 조회 (태그, 댓글 포함)
router.get('/detail/:id', async (req, res) => {
  try {
    const contentId = req.params.id;
    
    if (!contentId || isNaN(contentId)) {
      return res.status(400).json({ error: '유효하지 않은 컨텐츠 ID입니다.' });
    }
    
    console.log('[컨텐츠 상세] ID:', contentId);
    
    // 컨텐츠 기본 정보
    const [contents] = await pool.execute(`
      SELECT * FROM contents WHERE id = ?
    `, [contentId]);
    
    if (contents.length === 0) {
      return res.status(404).json({ error: '컨텐츠를 찾을 수 없습니다.' });
    }
    
    const content = contents[0];
    
    // 태그 정보 추가
    content.tags = await getContentTags(contentId);
    
    // 댓글 정보 추가
    const [comments] = await pool.execute(`
      SELECT 
        c.id, c.comment_text, c.created_at,
        u.username
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.content_id = ?
      ORDER BY c.created_at DESC
    `, [contentId]);
    
    content.comments = comments;
    
    // 조회수 증가
    await pool.execute(
      'UPDATE contents SET view_count = view_count + 1 WHERE id = ?',
      [contentId]
    );
    
    console.log(`[컨텐츠 상세] 조회 완료: ${content.title} (태그: ${content.tags.length}개, 댓글: ${content.comments.length}개)`);
    
    res.json(content);
  } catch (error) {
    console.error('컨텐츠 상세 조회 오류:', error);
    res.status(500).json({ 
      error: '컨텐츠 상세 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 태그별 컨텐츠 조회
router.get('/by-tag/:tagId', async (req, res) => {
  try {
    const tagId = req.params.tagId;
    
    if (!tagId || isNaN(tagId)) {
      return res.status(400).json({ error: '유효하지 않은 태그 ID입니다.' });
    }
    
    console.log('[태그별 컨텐츠] 태그 ID:', tagId);
    
    // 태그 정보 확인
    const [tagInfo] = await pool.execute('SELECT name FROM tags WHERE id = ?', [tagId]);
    
    if (tagInfo.length === 0) {
      return res.status(404).json({ error: '태그를 찾을 수 없습니다.' });
    }
    
    // 해당 태그가 연결된 컨텐츠들 조회
    const [contents] = await pool.execute(`
      SELECT 
        c.id, c.title, c.description, c.profile_image_url, 
        c.content_rating, c.duration_minutes, c.total_files,
        c.view_count, c.like_count, c.created_at, c.updated_at
      FROM contents c
      JOIN content_tags ct ON c.id = ct.content_id
      WHERE ct.tag_id = ?
      ORDER BY c.created_at DESC
    `, [tagId]);
    
    console.log(`[태그별 컨텐츠] ${contents.length}개 결과`);
    
    // 각 컨텐츠에 태그 정보 추가
    for (const content of contents) {
      content.tags = await getContentTags(content.id);
    }
    
    res.json({
      tag: tagInfo[0],
      contents: contents
    });
  } catch (error) {
    console.error('태그별 컨텐츠 조회 오류:', error);
    res.status(500).json({ 
      error: '태그별 컨텐츠 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
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