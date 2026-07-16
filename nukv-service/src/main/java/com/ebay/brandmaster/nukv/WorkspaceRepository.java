package com.ebay.brandmaster.nukv;

import com.ebay.dukes.CASValue;
import com.ebay.dukes.CacheClient;
import com.ebay.dukes.CacheFactory;
import com.ebay.dukes.nukv.trancoders.StringTranscoder;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class WorkspaceRepository {
    private static final String HEAD_KEY = "brandmaster:v1:workspace:head";
    private static final int NEVER_EXPIRE = 0;
    private static final int CHUNK_CHARACTERS = 5_000_000;
    private static final Map<String, String> STRONG_READ = Map.of("READ_CONSISTENCY", "STRONG");

    private final CacheFactory factory;
    private final ObjectMapper mapper;
    private final String cacheName;

    public WorkspaceRepository(CacheFactory factory, ObjectMapper mapper,
                               @Value("${brandmaster.nukv.cache-name}") String cacheName) {
        this.factory = factory;
        this.mapper = mapper;
        this.cacheName = cacheName;
    }

    public WorkspacePayloads.WorkspaceResponse read() throws Exception {
        CacheClient client = factory.getClient(cacheName);
        try {
            CASValue<Object> stored = client.asyncGets(HEAD_KEY, StringTranscoder.getInstance(), 5_000, STRONG_READ).get();
            if (stored == null || stored.getValue() == null) return new WorkspacePayloads.WorkspaceResponse(null, null, null, null);
            WorkspacePayloads.Head head = mapper.readValue(String.valueOf(stored.getValue()), WorkspacePayloads.Head.class);
            StringBuilder encoded = new StringBuilder();
            for (String key : head.chunks()) {
                Object value = client.get(key, StringTranscoder.getInstance(), STRONG_READ);
                if (value == null) throw new IllegalStateException("Workspace chunk is missing: " + key);
                encoded.append(value);
            }
            byte[] compressed = Base64.getDecoder().decode(encoded.toString());
            if (!sha256(compressed).equals(head.checksum())) throw new IllegalStateException("Workspace checksum does not match its manifest");
            JsonNode workspace = mapper.readTree(gunzip(compressed));
            return new WorkspacePayloads.WorkspaceResponse(head.revision(), head.updatedAt(), head.updatedBy(), workspace);
        } finally {
            factory.returnClient(client);
        }
    }

    public WorkspacePayloads.WorkspaceResponse write(String baseRevision, JsonNode workspace, String syncedBy) throws Exception {
        if (workspace == null || !workspace.isObject()) throw new IllegalArgumentException("workspace must be a JSON object");
        byte[] json = mapper.writeValueAsBytes(workspace);
        byte[] compressed = gzip(json);
        String encoded = Base64.getEncoder().encodeToString(compressed);
        String revision = UUID.randomUUID().toString();
        String updatedAt = Instant.now().toString();
        List<String> chunkKeys = new ArrayList<>();
        for (int offset = 0, index = 0; offset < encoded.length(); offset += CHUNK_CHARACTERS, index++) {
            chunkKeys.add("brandmaster:v1:workspace:revision:" + revision + ":chunk:" + String.format("%04d", index));
        }
        CacheClient client = factory.getClient(cacheName);
        try {
            CASValue<Object> current = client.asyncGets(HEAD_KEY, StringTranscoder.getInstance(), 5_000, STRONG_READ).get();
            WorkspacePayloads.Head currentHead = current == null || current.getValue() == null
                ? null : mapper.readValue(String.valueOf(current.getValue()), WorkspacePayloads.Head.class);
            String currentRevision = currentHead == null ? null : currentHead.revision();
            if (!java.util.Objects.equals(baseRevision, currentRevision)) throw new RevisionConflictException(currentRevision);
            WorkspacePayloads.Head next = new WorkspacePayloads.Head(revision, chunkKeys,
                currentHead == null ? List.of() : currentHead.chunks(), sha256(compressed), compressed.length, json.length, updatedAt, syncedBy);

            for (int offset = 0, index = 0; offset < encoded.length(); offset += CHUNK_CHARACTERS, index++) {
                String part = encoded.substring(offset, Math.min(encoded.length(), offset + CHUNK_CHARACTERS));
                Boolean saved = client.set(chunkKeys.get(index), NEVER_EXPIRE, part, StringTranscoder.getInstance()).get();
                if (!Boolean.TRUE.equals(saved)) throw new IllegalStateException("NuKV did not save workspace chunk " + index);
            }

            String headJson = mapper.writeValueAsString(next);
            boolean won;
            if (current == null) {
                won = Boolean.TRUE.equals(client.add(HEAD_KEY, NEVER_EXPIRE, headJson, StringTranscoder.getInstance()).get());
            } else {
                String code = client.cas(HEAD_KEY, current.getCas(), NEVER_EXPIRE, headJson, StringTranscoder.getInstance()).get().getResponseCode().toString();
                won = "OK".equalsIgnoreCase(code);
            }
            if (!won) {
                deleteQuietly(client, chunkKeys);
                throw new RevisionConflictException(currentRevision);
            }
            if (currentHead != null && currentHead.previousChunks() != null) deleteQuietly(client, currentHead.previousChunks());
            return new WorkspacePayloads.WorkspaceResponse(revision, updatedAt, syncedBy, workspace);
        } finally {
            factory.returnClient(client);
        }
    }

    private static byte[] gzip(byte[] input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(output)) { gzip.write(input); }
        return output.toByteArray();
    }

    private static byte[] gunzip(byte[] input) throws Exception {
        try (GZIPInputStream gzip = new GZIPInputStream(new ByteArrayInputStream(input))) {
            return gzip.readAllBytes();
        }
    }

    private static String sha256(byte[] input) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(input);
        return java.util.HexFormat.of().formatHex(digest);
    }

    private static void deleteQuietly(CacheClient client, List<String> keys) {
        for (String key : keys) {
            try { client.delete(key).get(); } catch (Exception ignored) { /* Retention cleanup is best effort. */ }
        }
    }

    public static class RevisionConflictException extends RuntimeException {
        private final String currentRevision;
        public RevisionConflictException(String currentRevision) {
            super("The shared workspace changed since the last pull");
            this.currentRevision = currentRevision;
        }
        public String currentRevision() { return currentRevision; }
    }
}
