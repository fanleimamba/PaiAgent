
# PaiAgent 开发规范指南

为保证代码质量、可维护性、安全性与可扩展性，请在开发过程中严格遵循以下规范。

## 一、项目环境与配置

- **工作目录**：`/Users/itwanger/Documents/GitHub/PaiAgent-one`
- **作者**：itwanger
- **操作系统**：Mac OS X
- **工具链**：Maven
- **SDK 版本**：Java 21.0.9

### 技术栈要求

- **主框架**：Spring Boot 3.4.1
- **语言版本**：Java 21
- **核心依赖**：
  - `spring-boot-starter-web`
  - `spring-boot-starter-data-redis`
  - `spring-boot-starter-validation`
  - `mybatis-plus-spring-boot3-starter` (3.5.5)
  - `spring-ai-openai-spring-boot-starter` (1.0.0-M5)
  - `langgraph4j-core-jdk8` (1.1.5)
  - `langgraph4j-spring-ai` (1.8.0-beta3)
  - `springdoc-openapi-starter-webmvc-ui` (2.3.0)

---

## 二、目录结构规范

项目采用前后端分离架构，后端基于 Maven 多模块结构。

```text
PaiAgent-one/
├── backend/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/paiagent/
│   │   │   │   ├── common/          # 公共工具类
│   │   │   │   ├── config/          # 配置类 (Redis, JWT, MinIO等)
│   │   │   │   ├── controller/      # 控制器层
│   │   │   │   ├── dto/             # 数据传输对象
│   │   │   │   ├── engine/          # 核心业务引擎
│   │   │   │   │   ├── agent/       # Agent定义
│   │   │   │   │   ├── dag/         # DAG图定义
│   │   │   │   │   ├── executor/    # 执行器
│   │   │   │   │   │   └── impl/    # 执行器实现
│   │   │   │   │   ├── langgraph/   # LangGraph4j集成
│   │   │   │   │   ├── llm/         # 大模型调用封装
│   │   │   │   │   ├── model/       # 数据模型
│   │   │   │   │   └── skill/       # 技能定义
│   │   │   │   ├── entity/          # 数据库实体
│   │   │   │   ├── interceptor/     # 拦截器
│   │   │   │   ├── mapper/          # MyBatis-Plus Mapper
│   │   │   │   └── service/         # 业务服务层
│   │   │   └── resources/
│   │   │       ├── skills/          # AI技能脚本目录
│   │   │       ├── application.yml  # 主配置文件
│   │   │       └── mapper/          # XML映射文件
│   │   └── test/                    # 单元测试
│   └── pom.xml                      # Maven配置文件
├── frontend/                        # 前端项目目录
└── docs/                            # 文档目录
```

---

## 三、分层架构规范

| 层级        | 职责说明                         | 开发约束与注意事项                                                                 |
|-------------|----------------------------------|------------------------------------------------------------------------------------|
| **Controller** | 处理 HTTP 请求与响应，定义 API 接口 | 不得直接访问数据库或复杂逻辑，必须通过 Service 层调用；返回 DTO 对象                 |
| **Service**    | 实现业务逻辑、事务管理与数据校验   | 使用 `@Transactional` 管理事务；调用 Mapper 层操作数据库；返回 VO 或 DTO           |
| **Mapper**     | 数据库访问与持久化操作             | 继承 `BaseMapper`；XML 映射文件位于 `resources/mapper/` 目录下                      |
| **Entity**     | 映射数据库表结构                   | 包名统一为 `com.paiagent.entity`；使用 Lombok 简化代码；字段需符合驼峰命名映射     |
| **Engine**     | 核心 AI 逻辑与图编排               | 位于 `engine` 包下；使用 LangGraph4j 进行状态图编排；需处理 LLM 调用与状态管理     |

### 接口与实现分离

- 所有业务接口（如 `UserService`）需放在对应的包下，具体实现类需放在接口所在包下的 `impl` 子包中（如 `UserServiceImpl`）。

---

## 四、安全与性能规范

### 输入校验

- 使用 `@Valid` 与 JSR-303 校验注解（如 `@NotBlank`, `@Size` 等）
  - **注意**：Spring Boot 3.x 中校验注解位于 `jakarta.validation.constraints.*`

### 安全配置

- **JWT 认证**：使用 `jjwt` (0.12.7) 生成 Token，请务必在生产环境中配置强密钥。
- **SQL 注入防范**：禁止手动拼接 SQL 字符串，必须使用 MyBatis-Plus 的动态 SQL 或 `@Param` 注解。

### 性能优化

- **缓存**：涉及高频读取的数据（如系统配置、Redis 链接状态）建议使用 Spring Cache 或 Redis。
- **数据库连接**：根据生产环境调整 `spring.datasource.hikari.*` 配置，防止连接池耗尽。

---

## 五、代码风格规范

### 命名规范

| 类型       | 命名方式             | 示例                  |
|------------|----------------------|-----------------------|
| 类名       | UpperCamelCase       | `UserServiceImpl`     |
| 方法/变量  | lowerCamelCase       | `saveUser()`          |
| 常量       | UPPER_SNAKE_CASE     | `MAX_LOGIN_ATTEMPTS`  |
| Mapper接口 | 接口名 + Mapper      | `UserMapper`          |
| Mapper XML | 接口名 + Mapper.xml  | `UserMapper.xml`      |

### 注释规范

- **语言**：所有注释使用 **中文**（项目作者第一语言）。
- **格式**：
  - 类、方法、字段需添加 **Javadoc** 注释。
  - 复杂的业务逻辑或算法（如 LangGraph 节点逻辑）需添加行内注释说明。

### 类型命名规范（阿里风格）

| 后缀 | 用途说明                     | 示例         |
|------|------------------------------|--------------|
| DTO  | 数据传输对象                 | `UserDTO`    |
| DO   | 数据库实体对象               | `UserDO`     |
| BO   | 业务逻辑封装对象             | `UserBO`     |
| VO   | 视图展示对象                 | `UserVO`     |
| Query| 查询参数封装对象             | `UserQuery`  |

### 实体类简化工具

- 使用 Lombok 注解替代手动编写 getter/setter/构造方法：
  - `@Data`
  - `@NoArgsConstructor`
  - `@AllArgsConstructor`
  - `@TableName` (MyBatis-Plus)

---

## 六、扩展性与日志规范

### 接口优先原则

- 所有业务逻辑通过接口定义（如 `UserService`），具体实现放在 `impl` 包中。

### 日志记录

- 使用 `@Slf4j` 注解代替 `System.out.println` 或 `System.err.println`。
- 日志级别使用规范：
  - `trace` / `debug`：开发调试信息。
  - `info`：关键业务流程节点记录（如流程开始、结束）。
  - `warn`：潜在问题或需要关注的异常情况。
  - `error`：严重错误（如数据库异常、AI 调用失败）。

### 配置管理

- 使用环境变量管理敏感信息（如 `JWT_SECRET`, `REDIS_PASSWORD`），避免硬编码。
- 配置文件优先级：`application-default.yml` < `application-prod.yml` < 环境变量。

---

## 七、编码原则总结

| 原则       | 说明                                       |
|------------|--------------------------------------------|
| **SOLID**  | 高内聚、低耦合，增强可维护性与可扩展性     |
| **DRY**    | 避免重复代码，提高复用性                   |
| **KISS**   | 保持代码简洁易懂                           |
| **YAGNI**  | 不实现当前不需要的功能                     |
| **OWASP**  | 防范常见安全漏洞，如 SQL 注入、XSS 等      |
