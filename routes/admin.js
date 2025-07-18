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

// 대시보드 통계 조회
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[통계 조회] 시작');
    
    const [userCount] = await pool.execute('SELECT COUNT(*) as count FROM users');
    const [contentCount] = await pool.execute('SELECT COUNT(*) as count FROM contents WHERE status = "active"');
    const [viewCount] = await pool.execute('SELECT SUM(view_count) as total FROM contents WHERE status = "active"');
    const [tagCount] = await pool.execute('SELECT COUNT(*) as count FROM tags');
    
    const stats = {
      totalUsers: userCount[0].count,
      totalContents: contentCount[0].count,
      totalViews: viewCount[0].total || 0,
      totalTags: tagCount[0].count
    };
    
    console.log('[통계 조회] 결과:', stats);
    
    res.json(stats);
  } catch (error) {
    console.error('통계 조회 오류:', error);
    res.status(500).json({ 
      error: '통계 조회 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 태그 처리 함수
const processTags = async (tagIds, contentId, connection) => {
  if (!Array.isArray(tagIds) || tagIds.length === 0) {
    return [];
  }
  
  const processedTagIds = [];
  
  for (const tagId of tagIds) {
    if (!tagId || isNaN(tagId)) continue;
    
    // 태그가 존재하는지 확인
    const [existingTag] = await connection.execute(
      'SELECT id FROM tags WHERE id = ?',
      [parseInt(tagId)]
    );
    
    if (existingTag.length > 0) {
      processedTagIds.push(parseInt(tagId));
    }
  }
  
  // content_tags에 삽입
  for (const tagId of processedTagIds) {
    await connection.execute(
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

// 컨텐츠 생성
router.post('/contents', authenticateToken, requireAdmin, upload.array('files', 20), async (req, res) => {
  let connection;
  
  try {
    const {
      title,
      description,
      contentRating,
      contentType,
      durationMinutes,
      audioQuality,
      tagIds,
      featured
    } = req.body;
    
    console.log('[컨텐츠 생성] 요청 데이터:', {
      title,
      description,
      contentRating,
      contentType,
      durationMinutes,
      audioQuality,
      tagIds,
      filesCount: req.files?.length || 0
    });
    
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
    
    connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 컨텐츠 생성
      const [result] = await connection.execute(
        `INSERT INTO contents 
         (title, description, content_rating, content_type, duration_minutes, 
          total_files, audio_quality, featured, view_count, like_count, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active')`,
        [
          title,
          description,
          contentRating || 'All',
          contentType || 'Audio',
          parseInt(durationMinutes) || 0,
          audioFiles.length,
          audioQuality || 'Standard',
          featured === 'true' || featured === true || false
        ]
      );
      
      const contentId = result.insertId;
      console.log('[컨텐츠 생성] 컨텐츠 ID:', contentId);
      
      // 태그 처리
      if (tagIds) {
        const parsedTagIds = Array.isArray(tagIds) ? tagIds : 
          (typeof tagIds === 'string' ? tagIds.split(',').map(id => id.trim()).filter(id => id && !isNaN(id)) : []);
        
        console.log('[태그 처리] 태그 IDs:', parsedTagIds);
        
        if (parsedTagIds.length > 0) {
          const processedTags = await processTags(parsedTagIds, contentId, connection);
          console.log('[태그 처리] 처리된 태그 수:', processedTags.length);
        }
      }
      
      // 파일 정리
      const fileInfo = await organizeFiles(contentId, null, req.files);
      console.log('[파일 정리] 완료:', fileInfo);
      
      await connection.commit();
      
      console.log(`[컨텐츠 생성 완료] ID: ${contentId}, 디렉토리: ${fileInfo.contentDir}`);
      
      res.status(201).json({
        message: '컨텐츠가 성공적으로 생성되었습니다.',
        contentId: contentId,
        fileInfo: fileInfo
      });
      
    } catch (error) {
      await connection.rollback();
      throw error;
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
    
    res.status(500).json({ 
      error: '컨텐츠 생성 중 오류가 발생했습니다.',
      details: error.message 
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// 컨텐츠 삭제
router.delete('/contents/:contentId', authenticateToken, requireAdmin, async (req, res) => {
  let connection;
  
  try {
    const contentId = req.params.contentId;
    
    console.log('[컨텐츠 삭제] ID:', contentId);
    
    const [existing] = await pool.execute(
      'SELECT id, title FROM contents WHERE id = ?',
      [contentId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ error: '컨텐츠를 찾을 수 없습니다.' });
    }
    
    connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 컨텐츠 삭제 (Foreign Key CASCADE로 관련 데이터 자동 삭제)
      await connection.execute(
        'DELETE FROM contents WHERE id = ?',
        [contentId]
      );
      
      await connection.commit();
      
      // 파일 디렉토리 삭제
      const contentDir = path.join(__dirname, `../../audio-files/content-${contentId}`);
      if (fs.existsSync(contentDir)) {
        fs.rmSync(contentDir, { recursive: true, force: true });
        console.log(`[디렉토리 삭제] ${contentDir}`);
      }
      
      console.log(`[컨텐츠 삭제 완료] ID: ${contentId}, 제목: ${existing[0].title}`);
      
      res.json({ message: '컨텐츠가 삭제되었습니다.' });
      
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    
  } catch (error) {
    console.error('컨텐츠 삭제 오류:', error);
    res.status(500).json({ 
      error: '컨텐츠 삭제 중 오류가 발생했습니다.',
      details: error.message 
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

module.exports = router;