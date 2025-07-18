const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireAdmin } = require('./auth');

// 모든 태그 조회 (카테고리별로 정렬)
router.get('/', async (req, res) => {
  try {
    const { category, active } = req.query;
    
    let query = `
      SELECT id, name, category, description, color, is_active, sort_order 
      FROM tags 
      WHERE 1=1
    `;
    const params = [];
    
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    if (active !== undefined) {
      query += ' AND is_active = ?';
      params.push(active === 'true' ? 1 : 0);
    }
    
    query += ' ORDER BY category, sort_order, name';
    
    const [tags] = await pool.execute(query, params);
    
    // 카테고리별로 그룹화
    const tagsByCategory = {};
    tags.forEach(tag => {
      if (!tagsByCategory[tag.category]) {
        tagsByCategory[tag.category] = [];
      }
      tagsByCategory[tag.category].push(tag);
    });
    
    res.json({
      tags,
      tagsByCategory
    });
  } catch (error) {
    console.error('태그 조회 오류:', error);
    res.status(500).json({ error: '태그 조회 중 오류가 발생했습니다.' });
  }
});

// 특정 카테고리의 태그들 조회
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { active = 'true' } = req.query;
    
    const [tags] = await pool.execute(
      `SELECT id, name, category, description, color, is_active, sort_order 
       FROM tags 
       WHERE category = ? AND is_active = ?
       ORDER BY sort_order, name`,
      [category, active === 'true' ? 1 : 0]
    );
    
    res.json(tags);
  } catch (error) {
    console.error('카테고리별 태그 조회 오류:', error);
    res.status(500).json({ error: '태그 조회 중 오류가 발생했습니다.' });
  }
});

// 새 태그 생성 (관리자 전용)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, category, description, color, sortOrder } = req.body;
    
    if (!name || !category) {
      return res.status(400).json({ error: '태그명과 카테고리는 필수입니다.' });
    }
    
    // 중복 태그 확인
    const [existing] = await pool.execute(
      'SELECT id FROM tags WHERE name = ? AND category = ?',
      [name, category]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 태그입니다.' });
    }
    
    const [result] = await pool.execute(
      `INSERT INTO tags (name, category, description, color, sort_order, is_active) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name,
        category || 'general',
        description || null,
        color || '#007bff',
        sortOrder || 0,
        true
      ]
    );
    
    const [newTag] = await pool.execute(
      'SELECT * FROM tags WHERE id = ?',
      [result.insertId]
    );
    
    console.log(`[태그 생성] ${category}/${name} 태그 생성됨`);
    
    res.status(201).json({
      message: '태그가 생성되었습니다.',
      tag: newTag[0]
    });
    
  } catch (error) {
    console.error('태그 생성 오류:', error);
    res.status(500).json({ error: '태그 생성 중 오류가 발생했습니다.' });
  }
});

// 태그 수정 (관리자 전용)
router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, description, color, sortOrder, isActive } = req.body;
    
    const [existing] = await pool.execute(
      'SELECT id FROM tags WHERE id = ?',
      [id]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ error: '태그를 찾을 수 없습니다.' });
    }
    
    const updates = [];
    const values = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    
    if (category !== undefined) {
      updates.push('category = ?');
      values.push(category);
    }
    
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    
    if (color !== undefined) {
      updates.push('color = ?');
      values.push(color);
    }
    
    if (sortOrder !== undefined) {
      updates.push('sort_order = ?');
      values.push(sortOrder);
    }
    
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(isActive);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '수정할 내용이 없습니다.' });
    }
    
    values.push(id);
    
    await pool.execute(
      `UPDATE tags SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    const [updatedTag] = await pool.execute(
      'SELECT * FROM tags WHERE id = ?',
      [id]
    );
    
    console.log(`[태그 수정] ID ${id} 태그 수정됨`);
    
    res.json({
      message: '태그가 수정되었습니다.',
      tag: updatedTag[0]
    });
    
  } catch (error) {
    console.error('태그 수정 오류:', error);
    res.status(500).json({ error: '태그 수정 중 오류가 발생했습니다.' });
  }
});

// 태그 삭제 (관리자 전용)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 태그가 사용 중인지 확인
    const [usage] = await pool.execute(
      'SELECT COUNT(*) as count FROM content_tags WHERE tag_id = ?',
      [id]
    );
    
    if (usage[0].count > 0) {
      return res.status(400).json({ 
        error: '사용 중인 태그는 삭제할 수 없습니다.',
        usageCount: usage[0].count
      });
    }
    
    const [result] = await pool.execute(
      'DELETE FROM tags WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '태그를 찾을 수 없습니다.' });
    }
    
    console.log(`[태그 삭제] ID ${id} 태그 삭제됨`);
    
    res.json({ message: '태그가 삭제되었습니다.' });
    
  } catch (error) {
    console.error('태그 삭제 오류:', error);
    res.status(500).json({ error: '태그 삭제 중 오류가 발생했습니다.' });
  }
});

module.exports = router;