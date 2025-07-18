const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireAdmin } = require('./auth');

// 알파벳 첫 글자를 추출하는 함수
const getFirstLetter = (name) => {
  if (!name) return '#';
  const firstChar = name.charAt(0).toLowerCase();
  if (firstChar >= 'a' && firstChar <= 'z') {
    return firstChar;
  } else if (firstChar >= '0' && firstChar <= '9') {
    return '0';
  } else {
    return '#';
  }
};

// 모든 태그 조회 (알파벳별로 정렬)
// routes/tags.js에서 모든 태그 조회 부분을 다음과 같이 수정하세요:

// 모든 태그 조회 (알파벳별로 정렬) - 수정된 버전
router.get('/', async (req, res) => {
  try {
    console.log('[태그 목록] 조회 시작');
    
    const { letter, search } = req.query;
    
    let query = `
      SELECT 
        t.id, t.name, t.first_letter, 
        COALESCE(t.usage_count, 0) as usage_count,
        COUNT(ct.content_id) as current_usage
      FROM tags t
      LEFT JOIN content_tags ct ON t.id = ct.tag_id
    `;
    const params = [];
    
    const conditions = [];
    
    // 알파벳 필터
    if (letter && letter !== 'all') {
      conditions.push('t.first_letter = ?');
      params.push(letter.toLowerCase());
    }
    
    // 검색 필터
    if (search && search.trim()) {
      conditions.push('t.name LIKE ?');
      params.push(`%${search.trim()}%`);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ' GROUP BY t.id, t.name, t.first_letter, t.usage_count';
    query += ' ORDER BY t.name ASC';
    
    console.log('[태그 목록] 실행할 쿼리:', query);
    console.log('[태그 목록] 파라미터:', params);
    
    const [tags] = await pool.execute(query, params);
    
    console.log(`[태그 목록] ${tags.length}개 태그 조회됨`);
    
    // 안전한 응답 구조
    const response = {
      success: true,
      tags: tags || [],
      total: tags ? tags.length : 0
    };
    
    // 알파벳별로 그룹화 (letter가 'all'이거나 없을 때만)
    if (!letter || letter === 'all') {
      const tagsByLetter = {};
      if (tags && tags.length > 0) {
        tags.forEach(tag => {
          const letterKey = tag.first_letter || '#';
          if (!tagsByLetter[letterKey]) {
            tagsByLetter[letterKey] = [];
          }
          tagsByLetter[letterKey].push(tag);
        });
      }
      response.tagsByLetter = tagsByLetter;
    }
    
    res.json(response);
  } catch (error) {
    console.error('태그 조회 오류:', error);
    res.status(500).json({ 
      success: false,
      error: '태그 조회 중 오류가 발생했습니다.',
      details: error.message,
      tags: []
    });
  }
});

// 사용 가능한 알파벳 목록 조회
router.get('/letters', async (req, res) => {
  try {
    console.log('[알파벳 목록] 조회 시작');
    
    const [letters] = await pool.execute(`
      SELECT 
        t.first_letter, 
        COUNT(*) as tag_count,
        SUM(CASE WHEN ct.content_id IS NOT NULL THEN 1 ELSE 0 END) as used_count
      FROM tags t
      LEFT JOIN content_tags ct ON t.id = ct.tag_id
      GROUP BY t.first_letter
      ORDER BY t.first_letter
    `);
    
    // 전체 알파벳 목록 생성 (a-z, 0, #)
    const allLetters = [];
    for (let i = 97; i <= 122; i++) { // a-z
      allLetters.push(String.fromCharCode(i));
    }
    allLetters.push('0', '#');
    
    const letterStats = allLetters.map(letter => {
      const found = letters.find(l => l.first_letter === letter);
      return {
        letter,
        tag_count: found ? found.tag_count : 0,
        used_count: found ? found.used_count : 0
      };
    });
    
    console.log(`[알파벳 목록] ${letterStats.length}개 문자 그룹`);
    
    res.json({
      letters: letterStats,
      total_tags: letters.reduce((sum, l) => sum + l.tag_count, 0)
    });
  } catch (error) {
    console.error('알파벳 목록 조회 오류:', error);
    res.status(500).json({ 
      error: '알파벳 목록 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 특정 알파벳의 태그들 조회
router.get('/letter/:letter', async (req, res) => {
  try {
    const { letter } = req.params;
    const { search, sortBy = 'name' } = req.query;
    
    console.log('[알파벳별 태그] 문자:', letter);
    
    let query = `
      SELECT 
        t.id, t.name, t.first_letter, t.usage_count,
        COUNT(ct.content_id) as current_usage,
        COUNT(DISTINCT c.id) as content_count
      FROM tags t
      LEFT JOIN content_tags ct ON t.id = ct.tag_id
      LEFT JOIN contents c ON ct.content_id = c.id AND c.status = 'active'
      WHERE t.first_letter = ?
    `;
    const params = [letter.toLowerCase()];
    
    // 검색 필터
    if (search) {
      query += ' AND t.name LIKE ?';
      params.push(`%${search}%`);
    }
    
    query += ' GROUP BY t.id, t.name, t.first_letter, t.usage_count';
    
    // 정렬
    const allowedSort = ['name', 'usage_count', 'current_usage'];
    const finalSort = allowedSort.includes(sortBy) ? sortBy : 'name';
    query += ` ORDER BY t.${finalSort}`;
    
    if (finalSort !== 'name') {
      query += ' DESC, t.name'; // 사용량순일 때는 내림차순, 이름은 오름차순
    }
    
    const [tags] = await pool.execute(query, params);
    
    console.log(`[알파벳별 태그] ${tags.length}개 태그 조회됨`);
    
    res.json({
      letter: letter.toUpperCase(),
      tags,
      total: tags.length
    });
  } catch (error) {
    console.error('알파벳별 태그 조회 오류:', error);
    res.status(500).json({ 
      error: '태그 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 인기 태그 조회 (사용량 기준)
router.get('/popular', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    console.log('[인기 태그] 조회 시작');
    
    const [tags] = await pool.execute(`
      SELECT 
        t.id, t.name, t.first_letter,
        COUNT(DISTINCT ct.content_id) as usage_count,
        COUNT(DISTINCT c.id) as active_content_count
      FROM tags t
      LEFT JOIN content_tags ct ON t.id = ct.tag_id
      LEFT JOIN contents c ON ct.content_id = c.id AND c.status = 'active'
      GROUP BY t.id, t.name, t.first_letter
      HAVING usage_count > 0
      ORDER BY usage_count DESC, t.name
      LIMIT ?
    `, [parseInt(limit)]);
    
    console.log(`[인기 태그] ${tags.length}개 태그 조회됨`);
    
    res.json({
      tags,
      total: tags.length
    });
  } catch (error) {
    console.error('인기 태그 조회 오류:', error);
    res.status(500).json({ 
      error: '인기 태그 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 새 태그 생성 (관리자 전용)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ 
        success: false,
        error: '태그명은 필수입니다.' 
      });
    }
    
    const trimmedName = name.trim();
    const firstLetter = getFirstLetter(trimmedName);
    
    console.log('[태그 생성] 요청:', { name: trimmedName, firstLetter });
    
    // 중복 태그 확인
    const [existing] = await pool.execute(
      'SELECT id FROM tags WHERE name = ?',
      [trimmedName]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: '이미 존재하는 태그입니다.' 
      });
    }
    
    const [result] = await pool.execute(
      `INSERT INTO tags (name, first_letter, usage_count) 
       VALUES (?, ?, 0)`,
      [trimmedName, firstLetter]
    );
    
    const [newTag] = await pool.execute(
      'SELECT * FROM tags WHERE id = ?',
      [result.insertId]
    );
    
    console.log(`[태그 생성] 완료: ${trimmedName} (${firstLetter}) (ID: ${result.insertId})`);
    
    res.status(201).json({
      success: true,
      message: '태그가 생성되었습니다.',
      tag: newTag[0]
    });
    
  } catch (error) {
    console.error('태그 생성 오류:', error);
    res.status(500).json({ 
      success: false,
      error: '태그 생성 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 태그 수정 (관리자 전용)
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    console.log('[태그 수정] ID:', id, '요청:', { name });
    
    const [existing] = await pool.execute(
      'SELECT id, name FROM tags WHERE id = ?',
      [id]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ error: '태그를 찾을 수 없습니다.' });
    }
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '태그명은 필수입니다.' });
    }
    
    const trimmedName = name.trim();
    const firstLetter = getFirstLetter(trimmedName);
    
    // 다른 태그와 중복 확인
    const [duplicate] = await pool.execute(
      'SELECT id FROM tags WHERE name = ? AND id != ?',
      [trimmedName, id]
    );
    
    if (duplicate.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 태그명입니다.' });
    }
    
    await pool.execute(
      'UPDATE tags SET name = ?, first_letter = ? WHERE id = ?',
      [trimmedName, firstLetter, id]
    );
    
    const [updatedTag] = await pool.execute(
      'SELECT * FROM tags WHERE id = ?',
      [id]
    );
    
    console.log(`[태그 수정] 완료: ID ${id} -> ${trimmedName} (${firstLetter})`);
    
    res.json({
      message: '태그가 수정되었습니다.',
      tag: updatedTag[0]
    });
    
  } catch (error) {
    console.error('태그 수정 오류:', error);
    res.status(500).json({ 
      error: '태그 수정 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 태그 삭제 (관리자 전용) - CASCADE로 자동 정리
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('[태그 삭제] ID:', id);
    
    // 태그 사용 현황 확인
    const [usage] = await pool.execute(`
      SELECT 
        t.name,
        COUNT(ct.content_id) as usage_count
      FROM tags t
      LEFT JOIN content_tags ct ON t.id = ct.tag_id
      WHERE t.id = ?
      GROUP BY t.id, t.name
    `, [id]);
    
    if (usage.length === 0) {
      return res.status(404).json({ error: '태그를 찾을 수 없습니다.' });
    }
    
    const usageCount = usage[0].usage_count || 0;
    const tagName = usage[0].name;
    
    if (usageCount > 0) {
      return res.status(400).json({ 
        error: `이 태그는 ${usageCount}개의 컨텐츠에서 사용 중입니다. 정말 삭제하시겠습니까?`,
        tagName,
        usageCount,
        requireConfirmation: true
      });
    }
    
    const [result] = await pool.execute(
      'DELETE FROM tags WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '태그를 찾을 수 없습니다.' });
    }
    
    console.log(`[태그 삭제] 완료: ${tagName} (ID: ${id})`);
    
    res.json({ 
      message: '태그가 삭제되었습니다.',
      deletedTag: tagName,
      deletedUsage: usageCount
    });
    
  } catch (error) {
    console.error('태그 삭제 오류:', error);
    res.status(500).json({ 
      error: '태그 삭제 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 강제 태그 삭제 (사용 중이어도 삭제)
router.delete('/:id/force', authenticateToken, requireAdmin, async (req, res) => {
  let connection;
  
  try {
    const { id } = req.params;
    
    console.log('[태그 강제 삭제] ID:', id);
    
    connection = await pool.getConnection();
    await connection.beginTransaction();
    
    // 사용 현황 확인
    const [usage] = await connection.execute(`
      SELECT 
        t.name,
        COUNT(ct.content_id) as usage_count
      FROM tags t
      LEFT JOIN content_tags ct ON t.id = ct.tag_id
      WHERE t.id = ?
      GROUP BY t.id, t.name
    `, [id]);
    
    if (usage.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '태그를 찾을 수 없습니다.' });
    }
    
    const usageCount = usage[0].usage_count || 0;
    const tagName = usage[0].name;
    
    // 태그 삭제 (CASCADE로 content_tags도 자동 삭제됨)
    const [result] = await connection.execute(
      'DELETE FROM tags WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '태그를 찾을 수 없습니다.' });
    }
    
    await connection.commit();
    
    console.log(`[태그 강제 삭제] 완료: ${tagName} (ID: ${id}) (연결 해제된 컨텐츠: ${usageCount}개)`);
    
    res.json({ 
      message: '태그가 강제 삭제되었습니다.',
      deletedTag: tagName,
      deletedUsage: usageCount
    });
    
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('태그 강제 삭제 오류:', error);
    res.status(500).json({ 
      error: '태그 강제 삭제 중 오류가 발생했습니다.',
      details: error.message 
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// 태그 사용량 업데이트 (관리자 전용)
router.post('/update-usage', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[태그 사용량 업데이트] 시작');
    
    const [result] = await pool.execute(`
      UPDATE tags SET usage_count = (
        SELECT COUNT(*) 
        FROM content_tags ct 
        JOIN contents c ON ct.content_id = c.id 
        WHERE ct.tag_id = tags.id AND c.status = 'active'
      )
    `);
    
    console.log(`[태그 사용량 업데이트] 완료: ${result.affectedRows}개 태그 업데이트됨`);
    
    res.json({
      message: '태그 사용량이 업데이트되었습니다.',
      updatedCount: result.affectedRows
    });
    
  } catch (error) {
    console.error('태그 사용량 업데이트 오류:', error);
    res.status(500).json({ 
      error: '태그 사용량 업데이트 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

module.exports = router;