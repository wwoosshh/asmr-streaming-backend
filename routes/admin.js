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
  const finalId = customId && customId.trim() ? customId.trim() : contentId;
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
    totalFiles: files.length,
    usedCustomId: !!customId
  };
};
router.get('/check-content-id/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const contentId = req.params.id;
    
    // ID 유효성 검사
    const parsedId = parseInt(contentId);
    if (isNaN(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        available: false,
        error: 'ID는 1 이상의 숫자여야 합니다.',
        suggestion: '유효한 숫자를 입력해주세요.'
      });
    }
    
    console.log('[ID 확인] 확인할 ID:', parsedId);
    
    // 중복 확인
    const [existing] = await pool.execute(
      'SELECT id, title FROM contents WHERE id = ?',
      [parsedId]
    );
    
    const isAvailable = existing.length === 0;
    
    const response = {
      id: parsedId,
      available: isAvailable,
      message: isAvailable ? 
        `ID ${parsedId}는 사용 가능합니다.` : 
        `ID ${parsedId}는 이미 사용 중입니다.`
    };
    
    if (!isAvailable && existing[0]) {
      response.existing_content = {
        title: existing[0].title,
        suggestion: '다른 ID를 선택해주세요.'
      };
    }
    
    console.log('[ID 확인] 결과:', response);
    res.json(response);
    
  } catch (error) {
    console.error('ID 확인 오류:', error);
    res.status(500).json({
      available: false,
      error: 'ID 확인 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

router.get('/suggest-content-id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[ID 제안] 시작');
    
    // 가장 큰 ID 조회
    const [maxIdResult] = await pool.execute(
      'SELECT MAX(id) as max_id FROM contents'
    );
    
    const maxId = maxIdResult[0].max_id || 0;
    const suggestedId = maxId + 1;
    
    // 제안된 ID가 사용 가능한지 확인 (혹시 모를 gap 확인)
    const [checkSuggested] = await pool.execute(
      'SELECT id FROM contents WHERE id = ?',
      [suggestedId]
    );
    
    let finalSuggestion = suggestedId;
    
    // 만약 제안된 ID도 사용 중이라면 다음 사용 가능한 ID 찾기
    if (checkSuggested.length > 0) {
      let nextId = suggestedId + 1;
      let found = false;
      
      // 최대 100개까지 확인
      for (let i = 0; i < 100; i++) {
        const [checkNext] = await pool.execute(
          'SELECT id FROM contents WHERE id = ?',
          [nextId]
        );
        
        if (checkNext.length === 0) {
          finalSuggestion = nextId;
          found = true;
          break;
        }
        nextId++;
      }
      
      if (!found) {
        return res.status(500).json({
          error: '사용 가능한 ID를 찾을 수 없습니다.',
          suggestion: '수동으로 ID를 입력해주세요.'
        });
      }
    }
    
    const response = {
      suggested_id: finalSuggestion,
      max_existing_id: maxId,
      message: `ID ${finalSuggestion}를 추천합니다.`,
      is_next_sequential: finalSuggestion === (maxId + 1)
    };
    
    console.log('[ID 제안] 결과:', response);
    res.json(response);
    
  } catch (error) {
    console.error('ID 제안 오류:', error);
    res.status(500).json({
      error: 'ID 제안 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

// 컨텐츠 생성
router.post('/contents', authenticateToken, requireAdmin, upload.array('files', 20), async (req, res) => {
  let connection;
  
  try {
    const {
      customId,        // 추가: 사용자 지정 ID
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
      customId,        // 추가
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
      let finalContentId;
      
      // 사용자 지정 ID 처리
      if (customId && customId.trim()) {
        const parsedCustomId = parseInt(customId.trim());
        
        // ID 유효성 검사
        if (isNaN(parsedCustomId) || parsedCustomId <= 0) {
          await connection.rollback();
          return res.status(400).json({ error: '컨텐츠 ID는 1 이상의 숫자여야 합니다.' });
        }
        
        // 중복 ID 확인
        const [existingContent] = await connection.execute(
          'SELECT id FROM contents WHERE id = ?',
          [parsedCustomId]
        );
        
        if (existingContent.length > 0) {
          await connection.rollback();
          return res.status(400).json({ 
            error: `ID ${parsedCustomId}는 이미 사용 중입니다. 다른 ID를 선택해주세요.` 
          });
        }
        
        // 사용자 지정 ID로 컨텐츠 생성
        const [result] = await connection.execute(
          `INSERT INTO contents 
           (id, title, description, content_rating, content_type, duration_minutes, 
            total_files, audio_quality, featured, view_count, like_count, status) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active')`,
          [
            parsedCustomId,
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
        
        finalContentId = parsedCustomId;
        console.log('[컨텐츠 생성] 사용자 지정 ID 사용:', finalContentId);
        
      } else {
        // 자동 생성 ID 사용 (기존 방식)
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
        
        finalContentId = result.insertId;
        console.log('[컨텐츠 생성] 자동 생성 ID 사용:', finalContentId);
      }
      
      // 태그 처리
      if (tagIds) {
        const parsedTagIds = Array.isArray(tagIds) ? tagIds : 
          (typeof tagIds === 'string' ? tagIds.split(',').map(id => id.trim()).filter(id => id && !isNaN(id)) : []);
        
        console.log('[태그 처리] 태그 IDs:', parsedTagIds);
        
        if (parsedTagIds.length > 0) {
          const processedTags = await processTags(parsedTagIds, finalContentId, connection);
          console.log('[태그 처리] 처리된 태그 수:', processedTags.length);
        }
      }
      
      // 파일 정리
      const fileInfo = await organizeFiles(finalContentId, customId, req.files);
      console.log('[파일 정리] 완료:', fileInfo);
      
      await connection.commit();
      
      console.log(`[컨텐츠 생성 완료] ID: ${finalContentId}, 디렉토리: ${fileInfo.contentDir}`);
      
      res.status(201).json({
        message: '컨텐츠가 성공적으로 생성되었습니다.',
        contentId: finalContentId,
        isCustomId: !!customId,
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
    
    // 사용자 지정 ID 관련 특별 처리
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ 
        error: '지정한 ID가 이미 사용 중입니다. 다른 ID를 선택해주세요.',
        details: error.message 
      });
    } else {
      res.status(500).json({ 
        error: '컨텐츠 생성 중 오류가 발생했습니다.',
        details: error.message 
      });
    }
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