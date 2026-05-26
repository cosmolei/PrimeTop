# 服务端 API 接口安全防护与渗透防御体系 - 详细设计

> 版本：1.0 | 创建日期：2026-05-26 | 状态：初稿

---

## 1. 概述

### 1.1 设计目标

本文档定义 PrimeTop 服务端所有对外暴露 API 接口的统一安全防护体系，确保：

1. **认证可靠**：每个请求经过强身份验证，防止未授权访问。
2. **防篡改防重放**：请求签名 + 时序校验，杜绝报文篡改和重放攻击。
3. **注入防御**：对 SQL 注入、XSS、命令注入等 OWASP Top 10 威胁形成纵深防御。
4. **文件安全**：上传文件类型、内容、大小严格校验，防止恶意文件上传。
5. **审计完备**：所有敏感接口调用留痕，支持事后追溯。
6. **自动响应**：异常行为自动检测、告警、临时封禁。

### 1.2 适用范围

- BFF 层对外 API（客户端直接调用）
- 内部服务间调用（Service-to-Service）
- 管理后台 API
- 第三方开放 API（B 端合作）
- Webhook 回调接口

### 1.3 与现有安全文档的关系

| 现有文档 | 覆盖范围 | 本文档定位 |
|---------|---------|-----------|
| 数据安全与隐私合规体系 | 数据分级、隐私合规、加密存储 | 本文聚焦 API 传输层与请求层安全 |
| 安全与内容合规系统 | AI 输出审核、内容过滤 | 本文聚焦接口层攻击防御 |
| 服务端密钥管理与敏感配置安全策略 | 密钥存储、轮换、分发 | 本文使用密钥但管理由该文档负责 |
| 服务端统一限流熔断与流量防护体系 | 限流、熔断、降级 | 本文聚焦安全维度的频率控制 |
| 服务端请求参数校验与数据清洗规范 | 参数校验、数据清洗 | 本文聚焦安全维度的输入过滤 |

---

## 2. 整体架构

### 2.1 安全防护分层模型

```
┌─────────────────────────────────────────────────────────┐
│                     客户端 / 调用方                       │
│              (SDK 内置签名 + 证书锁定)                    │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS (TLS 1.2+)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  WAF / DDoS 防护层                       │
│         (Cloudflare / 阿里云 WAF / 自建 Nginx)           │
│   - IP 黑名单  - 地域封禁  - DDoS 清洗                   │
│   - SQL 注入检测  - XSS 检测  - 蜘蛛识别                 │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  API 网关安全层                           │
│   - TLS 终止  - 请求签名验证  - JWT 校验                  │
│   - 频率限制  - 设备指纹校验  - 请求大小限制               │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  业务服务安全层                           │
│   - RBAC 鉴权  - 数据权限隔离  - 参数安全过滤             │
│   - SQL 参数化  - 输出编码  - 文件上传校验                │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  数据存储安全层                           │
│   - 加密存储  - 字段脱敏  - 访问审计                     │
└─────────────────────────────────────────────────────────┘
```

### 2.2 安全面数据流

```
Request → TLS验证 → WAF过滤 → 签名校验 → JWT解析 → 频率检查
       → 设备验证 → RBAC鉴权 → 参数过滤 → 业务处理 → 响应编码
       → 审计记录 → 响应返回
```

---

## 3. 请求签名机制

### 3.1 签名算法

所有客户端 API 请求必须携带签名，防止请求伪造和篡改。

#### 3.1.1 签名生成流程

```
1. 收集签名参数:
   - HTTP Method (GET/POST/PUT/DELETE)
   - 请求路径 (URI Path, 不含 query string)
   - 请求时间戳 (Unix 毫秒)
   - 请求随机数 (Nonce, UUID v4)
   - 请求体 Hash (SHA-256 of raw body, GET 请求为空字符串)
   - App 版本号
   - 设备指纹

2. 构造签名字符串 (HMAC-SHA256):
   signString = "{Method}\n{Path}\n{Timestamp}\n{Nonce}\n{BodyHash}\n{AppVersion}\n{DeviceFingerprint}"

3. 计算签名:
   signature = HMAC-SHA256(signString, appSecret)

4. 将签名信息放入请求头:
   X-PrimeTop-Signature: signature
   X-PrimeTop-Timestamp: timestamp
   X-PrimeTop-Nonce: nonce
   X-PrimeTop-AppVersion: appVersion
   X-PrimeTop-DeviceId: deviceFingerprint
```

#### 3.1.2 数据结构定义

```java
/**
 * 请求签名信息
 */
public record RequestSignature(
    /** HMAC-SHA256 签名值 (Base64 编码) */
    @NotBlank String signature,
    
    /** 请求时间戳 (Unix 毫秒) */
    @NotNull Long timestamp,
    
    /** 请求随机数 (防止重放) */
    @NotBlank String nonce,
    
    /** 客户端应用版本 */
    @NotBlank String appVersion,
    
    /** 设备指纹 */
    String deviceId
) {}

/**
 * 签名验证结果
 */
public record SignatureVerifyResult(
    boolean valid,
    SignatureRejectionReason reason,
    String clientId
) {}

public enum SignatureRejectionReason {
    MISSING_SIGNATURE,      // 缺少签名
    INVALID_FORMAT,         // 签名格式错误
    TIMESTAMP_EXPIRED,      // 时间戳过期
    NONCE_REPLAY,           // Nonce 重复使用
    SIGNATURE_MISMATCH,     // 签名不匹配
    APP_VERSION_BLOCKED,    // 应用版本已被封禁
    DEVICE_BLOCKED          // 设备已被封禁
}
```

#### 3.1.3 服务端签名验证器

```java
@Component
public class RequestSignatureVerifier {
    
    private static final long TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 分钟容忍窗口
    
    @Autowired
    private AppSecretRepository appSecretRepository;
    
    @Autowired
    private NonceCache nonceCache; // Redis-backed
    
    @Autowired
    private BlockedDeviceService blockedDeviceService;
    
    public SignatureVerifyResult verify(HttpServletRequest request, String rawBody) {
        // 1. 提取签名头
        String signature = request.getHeader("X-PrimeTop-Signature");
        String timestampStr = request.getHeader("X-PrimeTop-Timestamp");
        String nonce = request.getHeader("X-PrimeTop-Nonce");
        String appVersion = request.getHeader("X-PrimeTop-AppVersion");
        String deviceId = request.getHeader("X-PrimeTop-DeviceId");
        
        if (isAnyBlank(signature, timestampStr, nonce, appVersion)) {
            return new SignatureVerifyResult(false, MISSING_SIGNATURE, null);
        }
        
        // 2. 时间戳校验
        long timestamp;
        try {
            timestamp = Long.parseLong(timestampStr);
        } catch (NumberFormatException e) {
            return new SignatureVerifyResult(false, INVALID_FORMAT, null);
        }
        
        long now = System.currentTimeMillis();
        if (Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE_MS) {
            return new SignatureVerifyResult(false, TIMESTAMP_EXPIRED, null);
        }
        
        // 3. Nonce 防重放
        if (nonceCache.exists(nonce)) {
            return new SignatureVerifyResult(false, NONCE_REPLAY, null);
        }
        
        // 4. 设备封禁检查
        if (deviceId != null && blockedDeviceService.isBlocked(deviceId)) {
            return new SignatureVerifyResult(false, DEVICE_BLOCKED, null);
        }
        
        // 5. 构造签名字符串
        String method = request.getMethod();
        String path = request.getRequestURI();
        String bodyHash = rawBody != null ? sha256(rawBody) : "";
        
        String signString = String.join("\n",
            method, path, timestampStr, nonce, bodyHash, appVersion,
            deviceId != null ? deviceId : ""
        );
        
        // 6. 获取 AppSecret (根据平台和版本)
        String appSecret = appSecretRepository.getSecret(request.getHeader("User-Agent"));
        if (appSecret == null) {
            return new SignatureVerifyResult(false, INVALID_FORMAT, null);
        }
        
        // 7. 验证签名
        String expectedSignature = hmacSha256(signString, appSecret);
        if (!MessageDigest.isEqual(
            signature.getBytes(StandardCharsets.UTF_8),
            expectedSignature.getBytes(StandardCharsets.UTF_8)
        )) {
            return new SignatureVerifyResult(false, SIGNATURE_MISMATCH, null);
        }
        
        // 8. 记录 Nonce (TTL = 2 * 容忍窗口)
        nonceCache.put(nonce, timestamp, TIMESTAMP_TOLERANCE_MS * 2);
        
        return new SignatureVerifyResult(true, null, deviceId);
    }
}
```

### 3.2 Nonce 防重放策略

```java
/**
 * Redis-based Nonce 缓存
 * Key: primetop:nonce:{nonce_value}
 * Value: timestamp
 * TTL: 10 分钟 (2 × 容忍窗口)
 */
@Component
public class RedisNonceCache implements NonceCache {
    
    @Autowired
    private StringRedisTemplate redisTemplate;
    
    private static final String KEY_PREFIX = "primetop:nonce:";
    private static final Duration TTL = Duration.ofMinutes(10);
    
    @Override
    public boolean exists(String nonce) {
        return Boolean.TRUE.equals(
            redisTemplate.hasKey(KEY_PREFIX + nonce)
        );
    }
    
    @Override
    public void put(String nonce, long timestamp, long ttlMs) {
        redisTemplate.opsForValue()
            .set(KEY_PREFIX + nonce, String.valueOf(timestamp), TTL);
    }
}
```

### 3.3 签名密钥管理

```
密钥分发策略:
┌──────────────┐     构建时注入      ┌──────────────┐
│  密钥管理服务  │ ─────────────────→ │  客户端 APK   │
│ (KMS/HSM)    │                    │  (混淆存储)    │
└──────────────┘                    └──────────────┘
       │
       │ 版本化密钥
       ▼
┌──────────────────────────────┐
│  数据库: app_secret_versions  │
│  - platform (android/ios)    │
│  - min_version / max_version │
│  - secret_hash (存储哈希)     │
│  - active (boolean)          │
│  - created_at                │
└──────────────────────────────┘
```

**密钥轮换规则**：
1. 每个主版本使用独立密钥。
2. 版本更新时新密钥随新版本发布，旧密钥保留 90 天。
3. 发现密钥泄露时立即激活新密钥并封禁旧密钥，强制用户升级。
4. 密钥存储在 HSM/KMS 中，数据库仅存哈希值。

---

## 4. JWT 认证与会话安全

### 4.1 Token 模型

```java
/**
 * 访问令牌 (短有效期)
 */
public record AccessToken(
    /** 用户ID */
    String userId,
    /** 用户角色 */
    UserRole role,
    /** 会话ID */
    String sessionId,
    /** 设备ID */
    String deviceId,
    /** 签发时间 */
    long iat,
    /** 过期时间 */
    long exp,
    /** Token 版本 (用于强制注销) */
    long tokenVersion
) {}

/**
 * 刷新令牌 (长有效期)
 */
public record RefreshToken(
    /** 用户ID */
    String userId,
    /** 会话ID */
    String sessionId,
    /** 设备ID */
    String deviceId,
    /** 签发时间 */
    long iat,
    /** 过期时间 */
    long exp,
    /** 单次使用标识 (用后作废) */
    String jti
) {}
```

### 4.2 Token 配置

```yaml
auth:
  access-token:
    algorithm: "RS256"           # 非对称算法，公钥分发
    expiration: "30m"            # 访问令牌有效期 30 分钟
    issuer: "primetop"
    audience: "primetop-api"
    
  refresh-token:
    expiration: "30d"            # 刷新令牌有效期 30 天
    max-concurrent-sessions: 5   # 同一用户最多 5 个活跃设备
    rotation-enabled: true       # 刷新时自动轮换
    
  token-version:
    # 用户修改密码 / 管理员强制下线 时递增 tokenVersion
    # 所有旧 Token 自动失效
```

### 4.3 JWT 验证流程

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    
    @Autowired
    private JwtTokenProvider tokenProvider;
    
    @Autowired
    private TokenVersionService tokenVersionService;
    
    @Autowired
    private SessionService sessionService;
    
    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        
        // 1. 提取 Token
        String token = extractToken(request);
        if (token == null) {
            filterChain.doFilter(request, response);
            return;
        }
        
        // 2. 解析与签名验证
        AccessToken accessToken;
        try {
            accessToken = tokenProvider.parseAccessToken(token);
        } catch (JwtException e) {
            sendError(response, 401, "INVALID_TOKEN", "令牌无效或已过期");
            return;
        }
        
        // 3. 检查 Token 版本 (防止已注销 Token 复用)
        long currentVersion = tokenVersionService.getCurrentVersion(accessToken.userId());
        if (accessToken.tokenVersion() < currentVersion) {
            sendError(response, 401, "TOKEN_REVOKED", "令牌已被撤销");
            return;
        }
        
        // 4. 检查会话状态
        if (!sessionService.isActive(accessToken.sessionId())) {
            sendError(response, 401, "SESSION_EXPIRED", "会话已过期");
            return;
        }
        
        // 5. 设置认证上下文
        var authentication = new PrimeTopAuthentication(
            accessToken.userId(),
            accessToken.role(),
            accessToken.sessionId(),
            accessToken.deviceId()
        );
        SecurityContextHolder.getContext().setAuthentication(authentication);
        
        filterChain.doFilter(request, response);
    }
}
```

### 4.4 Refresh Token 轮换

```java
@Service
public class RefreshTokenService {
    
    /**
     * 刷新令牌轮换流程：
     * 1. 验证旧 Refresh Token
     * 2. 作废旧 Token (JTI 加入黑名单)
     * 3. 签发新 Access Token + Refresh Token 对
     * 4. 更新会话记录
     */
    @Transactional
    public TokenPair rotateRefreshToken(String oldRefreshToken) {
        // 解析旧 Token
        RefreshToken oldToken = tokenProvider.parseRefreshToken(oldRefreshToken);
        
        // 检查 JTI 是否已使用 (防止重放)
        if (refreshTokenBlacklist.isUsed(oldToken.jti())) {
            // 检测到重放攻击！可能是 Token 被盗
            // 立即撤销该用户所有会话
            emergencyRevokeAllSessions(oldToken.userId(), "REFRESH_TOKEN_REPLAY_DETECTED");
            throw new SecurityException("令牌重放检测，所有会话已撤销");
        }
        
        // 标记旧 Token 为已使用
        refreshTokenBlacklist.markUsed(oldToken.jti(), oldToken.exp());
        
        // 签发新 Token 对
        String sessionId = oldToken.sessionId();
        String userId = oldToken.userId();
        String deviceId = oldToken.deviceId();
        
        long tokenVersion = tokenVersionService.getCurrentVersion(userId);
        AccessToken newAccess = tokenProvider.createAccessToken(userId, sessionId, deviceId, tokenVersion);
        String newJti = UUID.randomUUID().toString();
        RefreshToken newRefresh = tokenProvider.createRefreshToken(userId, sessionId, deviceId, newJti);
        
        return new TokenPair(
            tokenProvider.serialize(newAccess),
            tokenProvider.serialize(newRefresh)
        );
    }
    
    /**
     * 紧急撤销用户所有会话
     */
    private void emergencyRevokeAllSessions(String userId, String reason) {
        // 1. 递增 tokenVersion → 所有旧 Token 自动失效
        tokenVersionService.incrementVersion(userId);
        
        // 2. 关闭所有活跃会话
        sessionService.terminateAllSessions(userId, reason);
        
        // 3. 发送安全告警
        securityAlertService.alert(SecurityEvent.builder()
            .type(SecurityEventType.TOKEN_REPLAY_DETECTED)
            .userId(userId)
            .reason(reason)
            .timestamp(Instant.now())
            .build());
        
        // 4. 记录审计日志
        auditLogService.log(AuditAction.EMERGENCY_SESSION_REVOCATION, userId, reason);
    }
}
```

### 4.5 多设备会话管理

```sql
-- 会话表
CREATE TABLE user_sessions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id      VARCHAR(64) NOT NULL COMMENT '会话唯一ID',
    user_id         BIGINT NOT NULL COMMENT '用户ID',
    device_id       VARCHAR(128) COMMENT '设备指纹',
    device_name     VARCHAR(128) COMMENT '设备名称',
    platform        VARCHAR(32) COMMENT 'android/ios/web',
    app_version     VARCHAR(32) COMMENT '应用版本',
    ip_address      VARCHAR(45) COMMENT '登录IP',
    geo_location    VARCHAR(128) COMMENT 'IP地理位置',
    user_agent      VARCHAR(512) COMMENT 'User-Agent',
    status          ENUM('active', 'terminated', 'expired') DEFAULT 'active',
    last_active_at  DATETIME COMMENT '最后活跃时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    terminated_at   DATETIME COMMENT '终止时间',
    terminate_reason VARCHAR(128) COMMENT '终止原因',
    
    INDEX idx_user_id (user_id),
    INDEX idx_session_id (session_id),
    INDEX idx_device_id (device_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 5. 注入攻击防御

### 5.1 SQL 注入防御

#### 5.1.1 纵深防御策略

```
第 1 层: WAF (Nginx/Lua 规则)
    │ 拦截明显 SQL 注入特征
    ▼
第 2 层: 参数校验 (Bean Validation)
    │ 类型检查 + 格式白名单
    ▼
第 3 层: ORM 参数化查询 (MyBatis/JPA)
    │ 强制使用参数绑定
    ▼
第 4 层: 数据库最小权限
    │ 应用账号仅授权必要 DML
```

#### 5.1.2 MyBatis 安全规范

```java
// ✅ 正确：使用参数化查询
@Mapper
public interface QuestionMapper {
    
    @Select("SELECT * FROM questions WHERE subject = #{subject} AND grade = #{grade}")
    List<Question> findBySubjectAndGrade(
        @Param("subject") String subject,
        @Param("grade") String grade
    );
}

// ❌ 错误：字符串拼接 (${} 语法)
// 绝对禁止在 MyBatis 中使用 ${} 拼接用户输入
// @Select("SELECT * FROM questions WHERE subject = '${subject}'")
```

#### 5.1.3 动态查询安全构建

```java
/**
 * 安全的动态查询构建器
 * 使用 MyBatis-Plus QueryWrapper 避免手写 SQL
 */
@Service
public class QuestionSearchService {
    
    public Page<Question> search(QuestionSearchRequest request) {
        LambdaQueryWrapper<Question> wrapper = new LambdaQueryWrapper<>();
        
        // 使用条件构造器，自动参数化
        if (request.getSubject() != null) {
            wrapper.eq(Question::getSubject, request.getSubject());
        }
        if (request.getGrade() != null) {
            wrapper.eq(Question::getGrade, request.getGrade());
        }
        if (request.getKeyword() != null) {
            // LIKE 查询自动转义特殊字符
            wrapper.like(Question::getContent, request.getKeyword());
        }
        
        // 排序字段白名单 (防止通过排序字段注入)
        Map<String, SFunction<Question, ?>> allowedSortFields = Map.of(
            "created_at", Question::getCreatedAt,
            "difficulty", Question::getDifficulty,
            "usage_count", Question::getUsageCount
        );
        
        SFunction<Question, ?> sortField = allowedSortFields.getOrDefault(
            request.getSortBy(), Question::getCreatedAt
        );
        
        wrapper.orderBy(true, request.isAsc(), sortField);
        
        return questionMapper.selectPage(request.toPage(), wrapper);
    }
}
```

#### 5.1.4 WAF SQL 注入规则 (Nginx + Lua)

```nginx
# /etc/nginx/conf.d/waf_sql_injection.conf

# SQL 注入关键字检测
set $sql_injection_patterns "";
if ($args ~* "(union.*select|insert.*into|delete.*from|update.*set|drop.*table|exec(\s|\()+|execute(\s|\()+|truncate.*table|alter.*table)") {
    set $sql_injection_patterns "detected";
}
if ($args ~* "(--|;|/\*|\*/|@@|#|char\(|concat\(|group_concat\(|0x[0-9a-f]+)") {
    set $sql_injection_patterns "detected";
}

# POST body 检测
if ($request_body ~* "(union.*select|insert.*into|delete.*from|drop.*table|exec(\s|\()+)") {
    set $sql_injection_patterns "detected";
}

# 拦截
if ($sql_injection_patterns = "detected") {
    return 403;
}
```

### 5.2 XSS 防御

#### 5.2.1 输出编码策略

```java
/**
 * 统一响应编码器
 * 所有 API 响应经过此编码器处理
 */
@Component
public class SecurityResponseEncoder {
    
    /**
     * JSON 输出编码 (默认所有 API 响应使用)
     * Jackson 配置自动转义 HTML 特殊字符
     */
    @Configuration
    public static class JacksonSecurityConfig {
        @Bean
        public ObjectMapper secureObjectMapper() {
            ObjectMapper mapper = new ObjectMapper();
            // 开启 HTML 转义
            mapper.getFactory().setCharacterEscapes(new HtmlCharacterEscapes());
            return mapper;
        }
    }
    
    /**
     * 自定义 HTML 字符转义
     */
    static class HtmlCharacterEscapes extends CharacterEscapes {
        private final int[] asciiEscapes;
        
        public HtmlCharacterEscapes() {
            asciiEscapes = CharacterEscapes.standardAsciiEscapesForJSON();
            asciiEscapes['<'] = CharacterEscapes.ESCAPE_STANDARD;
            asciiEscapes['>'] = CharacterEscapes.ESCAPE_STANDARD;
            asciiEscapes['&'] = CharacterEscapes.ESCAPE_STANDARD;
            asciiEscapes['"'] = CharacterEscapes.ESCAPE_STANDARD;
            asciiEscapes['\''] = CharacterEscapes.ESCAPE_STANDARD;
        }
        
        @Override
        public int[] getEscapeCodesForASCII() { return asciiEscapes; }
        
        @Override
        public SerializableString getEscapeSequence(int ch) {
            return new SerializedString("&#" + ch + ";");
        }
    }
}
```

#### 5.2.2 安全响应头

```java
/**
 * 全局安全响应头配置
 */
@Configuration
public class SecurityHeadersConfig {
    
    @Bean
    public WebMvcConfigurer securityHeadersConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(new HandlerInterceptor() {
                    @Override
                    public boolean preHandle(HttpServletRequest request, 
                                            HttpServletResponse response, 
                                            Object handler) {
                        // 防止 MIME 类型嗅探
                        response.setHeader("X-Content-Type-Options", "nosniff");
                        // 防止点击劫持
                        response.setHeader("X-Frame-Options", "DENY");
                        // XSS 防护 (旧浏览器)
                        response.setHeader("X-XSS-Protection", "1; mode=block");
                        // HSTS (强制 HTTPS)
                        response.setHeader("Strict-Transport-Security", 
                            "max-age=31536000; includeSubDomains; preload");
                        // CSP (内容安全策略)
                        response.setHeader("Content-Security-Policy",
                            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
                        // Referrer 策略
                        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
                        // 权限策略
                        response.setHeader("Permissions-Policy",
                            "camera=(), microphone=(), geolocation=(), payment=()");
                        return true;
                    }
                });
            }
        };
    }
}
```

### 5.3 命令注入防御

```java
/**
 * 安全的系统命令执行工具
 * 原则：禁止直接执行用户输入拼