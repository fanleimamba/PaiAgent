# PaiAgent Backend

AI Agent 流图执行面板后端服务

## 技术栈

- Java 21
- Spring Boot 3.4.1
- Spring AI 1.0.0-M5
- Spring AI Alibaba 1.0.0.2
- LangGraph4j Core 1.1.5 + Spring AI 1.8.0-beta3
- MyBatis-Plus 3.5.5
- MySQL 8.0
- Maven 3.8+

## 快速开始

### 1. 数据库初始化

确保 MySQL 已安装并启动,然后执行以下命令创建数据库和表:

```bash
mysql -u root -p < src/main/resources/schema.sql
```

或手动执行 `schema.sql` 中的 SQL 语句。

### 2. 配置数据库连接

修改 `src/main/resources/application.yml` 中的数据库配置:

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/paiagent?useUnicode=true&characterEncoding=utf-8&useSSL=false&serverTimezone=Asia/Shanghai
    username: root
    password: your_password
```

### 3. 运行项目

```bash
./mvnw spring-boot:run
```

或使用 IDE 运行 `PaiAgentApplication.java`

### 4. 访问 API 文档

启动成功后,访问: http://localhost:8080/swagger-ui.html

## 默认账户

- 用户名: admin
- 密码: 123

## API 接口

### 认证接口

- POST /api/auth/login - 用户登录
- POST /api/auth/logout - 用户登出
- GET /api/auth/current - 获取当前用户信息

### Skills 接口

- GET /api/skills - 获取所有技能摘要
- GET /api/skills/{name} - 获取技能详情
- GET /api/skills/{name}/references/{ref} - 获取技能引用文档

## 项目结构

```
src/main/java/com/paiagent/
├── common/           # 通用类
├── config/           # 配置类
├── controller/       # 控制器
├── dto/              # 数据传输对象
├── engine/           # 核心引擎
│   ├── dag/          # DAG 工作流引擎
│   ├── langgraph/    # LangGraph4j 状态图引擎
│   ├── skill/        # Skills 技能系统
│   ├── llm/          # LLM 调用层
│   ├── executor/     # 节点执行器
│   └── model/        # 数据模型
├── entity/           # 实体类
├── interceptor/      # 拦截器
├── mapper/           # MyBatis Mapper
└── service/          # 服务层
```
