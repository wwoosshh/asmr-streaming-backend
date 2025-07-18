const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticateToken, requireAdmin } = require('./auth');

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: 20
  },
  fileFilter: (req, file, cb) => {
    const allowedAudioTypes = ['.mp3', '.m4a', '.wav', '.aac'];
    const allowedImageTypes = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedAudioTypes.includes(ext) || allowedImageTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 파일 형식입니다.'), false);
    }
  }
});

// 태그 처리 함수
const processTags = async (tagIds, contentId) => {
  if (!Array.isArray(tagIds) || tagIds.length === 0) {
    return [];
  }
  
  const processedTagIds = [];
  
  for (const tagId of tagIds) {
    if (!tagId || isNaN(tagId)) continue;
    
    // 태그가 존재하는지 확인
    const [existingTag] = await pool.execute(
      'SELECT id FROM tags WHERE id = ? AND is_active = 1',
      [parseInt(tagId)]
    );
    
    if (existingTag.length > 0) {
      processedTagIds.push(parseInt(tagId));
    }
  }
  
  // content_tags에 삽입
  for (const tagId of processedTagIds) {
    await pool.execute(
      'INSERT IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)',
      [contentId, tagId]
    );
  }
  
  return processedTagIds;
};

// 파일 이동 및 구조 생성
const organizeFiles = async (contentId, customId, files) => {
  const finalId = customId || contentId;
  const contentDir = path.join(__dirname, `../../audio-files/content-${finalId}`);
  
  if (!fs.existsSync(contentDir)) {
    fs.mkdirSync(contentDir, { recursive: true });
  }
  
  const audioFiles = [];
  const imageFiles = [];
  
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const tempPath = file.path;
    
    if (['.mp3', '.m4a', '.wav', '.aac'].includes(ext)) {
      audioFiles.push(file);
    } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      imageFiles.push(file);
    }
    
    const finalPath = path.join(contentDir, file.originalname);
    fs.renameSync(tempPath, finalPath);
    
    console.log(`[파일 이동] ${tempPath} -> ${finalPath}`);
  }
  
  return {
    contentDir,
    audioFiles: audioFiles.length,
    imageFiles: imageFiles.length,
    totalFiles: files.length
  };
};

// 대시보드 통계 조회
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [userCount] = await pool.execute('SELECT COUNT(*) as count FROM users');
    const [contentCount] = await pool.execute('SELECT COUNT(*) as count FROM contents');
    const [viewCount] = await pool.execute('SELECT SUM(view_count) as total FROM contents');
    const [tagCount] = await pool.execute('SELECT COUNT(*) as count FROM tags WHERE is_active = 1');
    
    res.json({
      totalUsers: userCount[0].count,
      totalContents: contentCount[0].count,
      totalViews: viewCount[0].total || 0,
      totalTags: tagCount[0].count
    });
  } catch (error) {
    console.error('통계 조회 오류:', error);
    res.status(500).json({ error: '통계 조회 중 오류가 발생했습니다.' });
  }
});

// 컨텐츠 생성
router.post('/contents', authenticateToken, requireAdmin, upload.array('files', 20), async (req, res) => {
  try {
    const {
      title,
      description,
      contentRating,
      durationMinutes,
      customId,
      tagIds,
      featured
    } = req.body;
    
    if (!title || !description) {
      return res.status(400).json({ error: '제목과 설명은 필수입니다.' });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '최소 하나의 파일을 업로드해야 합니다.' });
    }
    
    const audioFiles = req.files.filter(file => {
      const ext = path.extname(file.originalname).toLowerCase();
      return ['.mp3', '.m4a', '.wav', '.aac'].includes(ext);
    });
    
    if (audioFiles.length === 0) {
      return res.status(400).json({ error: '최소 하나의 오디오 파일이 필요합니다.' });
    }
    
    // 커스텀 ID 중복 확인
    if (customId) {
      const [existingCustomId] = await pool.execute(
        'SELECT id FROM contents WHERE custom_id = ?',
        [customId]
      );
      
      if (existingCustomId.length > 0) {
        return res.status(400).json({ error: '이미 사용 중인 커스텀 ID입니다.' });
      }
      
      // 커스텀 ID 검증
      if (!/^[a-zA-Z0-9_-]+$/.test(customId)) {
        return res.status(400).json({ error: '커스텀 ID는 영문, 숫자, -, _만 사용 가능합니다.' });
      }
    }
    
    console.log(`[컨텐츠 생성] 제목: ${title}, 파일 수: ${req.files.length}, 커스텀 ID: ${customId || '없음'}`);
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 컨텐츠 생성
      const [result] = await connection.execute(
        `INSERT INTO contents 
         (title, description, content_rating, duration_minutes, total_files, 
          view_count, like_count, custom_id, featured, status) 
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'published')`,
        [
          title,
          description,
          contentRating || 'SFW',
          parseInt(durationMinutes) || 0,
          audioFiles.length,
          customId || null,
          featured === 'true' || false
        ]
      );
      
      const contentId = result.insertId;
      
      // 태그 처리
      if (tagIds) {
        const parsedTagIds = Array.isArray(tagIds) ? tagIds : 
          (typeof tagIds === 'string' ? tagIds.split(',').map(id => id.trim()).filter(id => id) : []);
        await processTags(parsedTagIds, contentId);
      }
      
      // 파일 정리
      const fileInfo = await organizeFiles(contentId, customId, req.files);
      
      await connection.commit();
      
      console.log(`[컨텐츠 생성 완료] ID: ${contentId}, 커스텀 ID: ${customId || '없음'}, 디렉토리: ${fileInfo.contentDir}`);
      
      res.status(201).json({
        message: '컨텐츠가 성공적으로 생성되었습니다.',
        contentId: contentId,
        customId: customId,
        fileInfo: fileInfo
      });
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error('컨텐츠 생성 오류:', error);
    
    // 업로드된 파일 정리
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    
    res.status(500).json({ error: '컨텐츠 생성 중 오류가 발생했습니다.' });
  }
});

// 컨텐츠 수정
router.patch('/contents/:contentId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const contentId = req.params.contentId;
    const { title, description, contentRating, durationMinutes, tagIds, featured } = req.body;
    
    const [existing] = await pool.execute(
      'SELECT id, custom_id FROM contents WHERE id = ?',
      [contentId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ error: '컨텐츠를 찾을 수 없습니다.' });
    }
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 컨텐츠 업데이트
      const updates = [];
      const values = [];
      
      if (title !== undefined) {
        updates.push('title = ?');
        values.push(title);
      }
      
      if (description !== undefined) {
        updates.push('description = ?');
        values.push(description);
      }
      
      if (contentRating !== undefined) {
        updates.push('content_rating = ?');
        values.push(contentRating);
      }
      
      if (durationMinutes !== undefined) {
        updates.push('duration_minutes = ?');
        values.push(parseInt(durationMinutes) || 0);
      }
      
      if (featured !== undefined) {
        updates.push('featured = ?');
        values.push(featured === 'true' || featured === true);
      }
      
      if (updates.length > 0) {
        updates.push('last_updated = CURRENT_TIMESTAMP');
        values.push(contentId);
        
        await connection.execute(
          `UPDATE contents SET ${updates.join(', ')} WHERE id = ?`,
          values
        );
      }
      
      // 태그 업데이트
      if (tagIds !== undefined) {
        await connection.execute(
          'DELETE FROM content_tags WHERE content_id = ?',
          [contentId]
        );
        
        if (tagIds && tagIds.length > 0) {
          const parsedTagIds = Array.isArray(tagIds) ? tagIds : 
            (typeof tagIds === 'string' ? tagIds.split(',').map(id => id.trim()).filter(id => id) : []);
          await processTags(parsedTagIds, contentId);
        }
      }
      
      await connection.commit();
      
      console.log(`[컨텐츠 수정] ID: ${contentId}`);
      
      res.json({ message: '컨텐츠가 수정되었습니다.' });
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error('컨텐츠 수정 오류:', error);
    res.status(500).json({ error: '컨텐츠 수정 중 오류가 발생했습니다.' });
  }
});

// 컨텐츠 삭제
router.delete('/contents/:contentId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const contentId = req.params.contentId;
    
    const [existing] = await pool.execute(
      'SELECT id, custom_id FROM contents WHERE id = ?',
      [contentId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ error: '컨텐츠를 찾을 수 없습니다.' });
    }
    
    const customId = existing[0].custom_id;
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      await connection.execute(
        'DELETE FROM content_tags WHERE content_id = ?',
        [contentId]
      );
      
      await connection.execute(
        'DELETE FROM contents WHERE id = ?',
        [contentId]
      );
      
      await connection.commit();
      
      // 파일 디렉토리 삭제
      const contentDir = path.join(__dirname, `../../audio-files/content-${customId || contentId}`);
      if (fs.existsSync(contentDir)) {
        fs.rmSync(contentDir, { recursive: true, force: true });
        console.log(`[디렉토리 삭제] ${contentDir}`);
      }
      
      console.log(`[컨텐츠 삭제] ID: ${contentId}, 커스텀 ID: ${customId || '없음'}`);
      
      res.json({ message: '컨텐츠가 삭제되었습니다.' });
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error('컨텐츠 삭제 오류:', error);
    res.status(500).json({ error: '컨텐츠 삭제 중 오류가 발생했습니다.' });
  }
});

// 모든 태그 조회
router.get('/tags', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [tags] = await pool.execute(
      'SELECT id, name, category FROM tags ORDER BY name'
    );
    
    res.json(tags);
  } catch (error) {
    console.error('태그 조회 오류:', error);
    res.status(500).json({ error: '태그 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;