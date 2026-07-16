package com.ebay.brandmaster.nukv;

import com.ebay.dukes.CacheFactory;
import com.ebay.dukes.builder.DefaultCacheFactoryBuilder;
import jakarta.annotation.PreDestroy;
import jakarta.ws.rs.ApplicationPath;
import org.glassfish.jersey.server.ResourceConfig;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ApplicationPath("/brandmaster-sync")
public class NuKvResourceConfig extends ResourceConfig {
    private CacheFactory factory;

    @Value("${brandmaster.nukv.cache-name}")
    private String cacheName;

    public NuKvResourceConfig() {
        register(WorkspaceResource.class);
    }

    @Bean
    public CacheFactory cacheFactory() {
        factory = DefaultCacheFactoryBuilder.newBuilder().cache(cacheName).build();
        var client = factory.getClient(cacheName);
        factory.returnClient(client);
        return factory;
    }

    @PreDestroy
    public void shutdown() {
        if (factory != null) factory.shutdown();
    }
}
