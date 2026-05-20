package com.copilotkit.showcase.springai;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers the {@link AimockHeaderInterceptor} on all incoming requests so
 * that {@code x-*} prefixed headers are captured into
 * {@link AimockHeaderContext} before any controller runs.
 */
@Configuration
public class AimockWebMvcConfig implements WebMvcConfigurer {

    private final AimockHeaderInterceptor aimockHeaderInterceptor;

    @Autowired
    public AimockWebMvcConfig(AimockHeaderInterceptor aimockHeaderInterceptor) {
        this.aimockHeaderInterceptor = aimockHeaderInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(aimockHeaderInterceptor);
    }
}
