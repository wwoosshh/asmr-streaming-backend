const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireAdmin } = require('./auth');

// 헬스 체크 (인증 불필요)
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: '서버가 정상적으로 실행 중입니다.',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 데이터베이스 연결 테스트 (관리자 전용)
router.get('/db-test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[DB 테스트] 시작');
    
    // 간단한 쿼리로 DB 연결 확인
    const [result] = await pool.execute('SELECT 1 as test_value, NOW() as db_timestamp');
    
    console.log('[DB 테스트] 성공:', result[0]);
    
    // 추가 테스트: 기본 테이블들 존재 확인
    const [tableCheck] = await pool.execute("SHOW TABLES LIKE 'users'");
    const [tagTableCheck] = await pool.execute("SHOW TABLES LIKE 'tags'");
    
    res.json({
      status: 'success',
      message: 'DB 연결 정상',
      test_result: result[0],
      tables_status: {
        users_table: tableCheck.length > 0 ? 'EXISTS' : 'MISSING',
        tags_table: tagTableCheck.length > 0 ? 'EXISTS' : 'MISSING'
      },
      connection_info: {
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        user: process.env.DB_USER
      }
    });
  } catch (error) {
    console.error('[DB 테스트] 오류:', error);
    res.status(500).json({
      status: 'error',
      message: 'DB 연결 실패',
      error: error.message,
      error_code: error.code,
      solution: 'DB 서버가 실행 중인지, 연결 정보가 올바른지 확인하세요.'
    });
  }
});

// 데이터베이스 구조 확인 (관리자 전용)
router.get('/db-structure', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[DB 구조 확인] 시작');
    
    // 현재 데이터베이스명 확인
    const [dbResult] = await pool.execute('SELECT DATABASE() as db_name');
    const databaseName = dbResult[0].db_name;
    
    // 테이블 목록 조회
    const [tables] = await pool.execute('SHOW TABLES');
    const tableNames = tables.map(row => Object.values(row)[0]);
    
    console.log('[DB 구조 확인] 테이블 목록:', tableNames);
    
    // 각 테이블의 구조 확인
    const tableStructures = {};
    
    for (const tableName of tableNames) {
      try {
        const [columns] = await pool.execute(`DESCRIBE \`${tableName}\``);
        tableStructures[tableName] = columns;
        console.log(`[DB 구조 확인] ${tableName} 테이블: ${columns.length}개 컬럼`);
      } catch (error) {
        console.error(`[DB 구조 확인] ${tableName} 테이블 오류:`, error);
        tableStructures[tableName] = { error: error.message };
      }
    }
    
    // 태그 테이블 특별 확인
    let tagTableInfo = null;
    if (tableNames.includes('tags')) {
      try {
        const [tagCount] = await pool.execute('SELECT COUNT(*) as total_tags FROM tags');
        const [sampleTags] = await pool.execute('SELECT * FROM tags LIMIT 5');
        tagTableInfo = {
          total_count: tagCount[0].total_tags,
          sample_data: sampleTags
        };
      } catch (error) {
        tagTableInfo = { error: error.message };
      }
    }
    
    res.json({
      status: 'success',
      database: databaseName,
      total_tables: tableNames.length,
      tables: tableStructures,
      table_names: tableNames,
      tag_info: tagTableInfo
    });
    
  } catch (error) {
    console.error('[DB 구조 확인] 오류:', error);
    res.status(500).json({
      status: 'error',
      message: 'DB 구조 확인 실패',
      error: error.message,
      solution: 'DB 권한을 확인하거나 테이블이 존재하는지 확인하세요.'
    });
  }
});

// 태그 테이블 전용 디버그 (관리자 전용)
router.get('/tags-debug', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[태그 디버그] 시작');
    
    // 태그 테이블 존재 확인
    const [tableExists] = await pool.execute("SHOW TABLES LIKE 'tags'");
    if (tableExists.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'tags 테이블이 존재하지 않습니다.',
        solution: 'DB 마이그레이션을 실행하거나 테이블을 생성하세요.'
      });
    }
    
    // 태그 테이블 구조 확인
    const [structure] = await pool.execute('DESCRIBE tags');
    
    // 태그 데이터 확인
    const [totalCount] = await pool.execute('SELECT COUNT(*) as total FROM tags');
    const [allTags] = await pool.execute('SELECT * FROM tags ORDER BY id DESC LIMIT 10');
    
    // 첫 글자별 분포 확인
    const [letterDistribution] = await pool.execute(`
      SELECT first_letter, COUNT(*) as count 
      FROM tags 
      GROUP BY first_letter 
      ORDER BY first_letter
    `);
    
    console.log(`[태그 디버그] 총 ${totalCount[0].total}개 태그 발견`);
    
    res.json({
      status: 'success',
      table_structure: structure,
      total_tags: totalCount[0].total,
      recent_tags: allTags,
      letter_distribution: letterDistribution,
      test_query_results: {
        simple_select: allTags.length > 0 ? 'SUCCESS' : 'EMPTY',
        group_by_letter: letterDistribution.length > 0 ? 'SUCCESS' : 'EMPTY'
      }
    });
    
  } catch (error) {
    console.error('[태그 디버그] 오류:', error);
    res.status(500).json({
      status: 'error',
      message: '태그 디버그 실패',
      error: error.message,
      sql_state: error.sqlState,
      error_code: error.code
    });
  }
});

// 시스템 정보 조회 (관리자 전용)
router.get('/system-info', authenticateToken, requireAdmin, (req, res) => {
  try {
    const systemInfo = {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      memory_usage: process.memoryUsage(),
      uptime: process.uptime(),
      env: {
        node_env: process.env.NODE_ENV || 'development',
        port: process.env.PORT || '5159',
        db_host: process.env.DB_HOST,
        db_name: process.env.DB_NAME
      }
    };
    
    res.json({
      status: 'success',
      system: systemInfo
    });
  } catch (error) {
    console.error('[시스템 정보] 오류:', error);
    res.status(500).json({
      status: 'error',
      message: '시스템 정보 조회 실패',
      error: error.message
    });
  }
});

// 로그 레벨 테스트 (관리자 전용)
router.get('/test-logs', authenticateToken, requireAdmin, (req, res) => {
  console.log('[로그 테스트] INFO 레벨 로그');
  console.warn('[로그 테스트] WARN 레벨 로그');
  console.error('[로그 테스트] ERROR 레벨 로그');
  
  res.json({
    status: 'success',
    message: '로그 테스트 완료. 콘솔을 확인하세요.',
    timestamp: new Date().toISOString()
  });
});

router.get('/users-debug', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[사용자 디버그] 시작');
    
    // 사용자 테이블 존재 확인
    const [tableExists] = await pool.execute("SHOW TABLES LIKE 'users'");
    if (tableExists.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'users 테이블이 존재하지 않습니다.',
        solution: 'DB 마이그레이션을 실행하거나 테이블을 생성하세요.'
      });
    }
    
    // 사용자 테이블 구조 확인
    const [structure] = await pool.execute('DESCRIBE users');
    
    // 사용자 데이터 확인
    const [totalCount] = await pool.execute('SELECT COUNT(*) as total FROM users');
    const [allUsers] = await pool.execute('SELECT id, username, email, role, created_at FROM users ORDER BY id DESC LIMIT 5');
    
    // 권한별 분포 확인
    const [roleDistribution] = await pool.execute(`
      SELECT role, COUNT(*) as count 
      FROM users 
      GROUP BY role 
      ORDER BY role
    `);
    
    console.log(`[사용자 디버그] 총 ${totalCount[0].total}개 사용자 발견`);
    
    res.json({
      status: 'success',
      table_structure: structure,
      total_users: totalCount[0].total,
      recent_users: allUsers,
      role_distribution: roleDistribution,
      test_query_results: {
        simple_select: allUsers.length > 0 ? 'SUCCESS' : 'EMPTY',
        group_by_role: roleDistribution.length > 0 ? 'SUCCESS' : 'EMPTY'
      }
    });
    
  } catch (error) {
    console.error('[사용자 디버그] 오류:', error);
    res.status(500).json({
      status: 'error',
      message: '사용자 디버그 실패',
      error: error.message,
      sql_state: error.sqlState,
      error_code: error.code
    });
  }
});

module.exports = router;