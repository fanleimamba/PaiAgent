package com.paiagent.service;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class AuthServiceTest {

    private static final String JWT_SECRET = "paiagent-one-jwt-secret-key-change-me-to-a-long-random-string";

    @Test
    void shouldGenerateAndValidateJwtToken() {
        AuthService authService = createAuthService(new HashMap<>());

        AuthService.AuthTokens tokens = authService.login("admin", "123");

        assertNotNull(tokens);
        assertNotNull(tokens.accessToken());
        assertNotNull(tokens.refreshToken());
        assertTrue(authService.validateToken(tokens.accessToken()));
        assertEquals("admin", authService.getUsernameByToken(tokens.accessToken()));
    }

    @Test
    void shouldRefreshAcrossServiceInstances() {
        Map<String, String> redisStore = new HashMap<>();
        AuthService issuer = createAuthService(redisStore);
        AuthService validator = createAuthService(redisStore);

        AuthService.AuthTokens issued = issuer.login("admin", "123");
        AuthService.AuthTokens refreshed = validator.refresh(issued.refreshToken());

        assertNotNull(issued);
        assertNotNull(refreshed);
        assertTrue(validator.validateToken(refreshed.accessToken()));
        assertEquals("admin", validator.getUsernameByToken(refreshed.accessToken()));
        assertNull(validator.refresh(issued.refreshToken()));
    }

    @Test
    void shouldRejectWrongCredentials() {
        AuthService authService = createAuthService(new HashMap<>());

        assertNull(authService.login("admin", "wrong-password"));
    }

    private AuthService createAuthService(Map<String, String> redisStore) {
        AuthService authService = new AuthService();
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOperations = mock(ValueOperations.class);

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        doAnswer(invocation -> {
            redisStore.put(invocation.getArgument(0), invocation.getArgument(1));
            return null;
        }).when(valueOperations).set(anyString(), anyString(), any(Duration.class));
        when(valueOperations.get(anyString())).thenAnswer(invocation -> redisStore.get(invocation.getArgument(0)));
        when(redisTemplate.delete(anyString())).thenAnswer(invocation -> redisStore.remove(invocation.getArgument(0)) != null);

        ReflectionTestUtils.setField(authService, "jwtSecret", JWT_SECRET);
        ReflectionTestUtils.setField(authService, "accessTokenExpirationMinutes", 120L);
        ReflectionTestUtils.setField(authService, "refreshTokenExpirationHours", 168L);
        ReflectionTestUtils.setField(authService, "stringRedisTemplate", redisTemplate);
        return authService;
    }
}
