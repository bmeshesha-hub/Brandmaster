package com.ebay.brandmaster.nukv;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

public final class WorkspacePayloads {
    private WorkspacePayloads() {}

    public record WriteRequest(String baseRevision, JsonNode workspace, String syncedBy) {}
    public record WorkspaceResponse(String revision, String updatedAt, String updatedBy, JsonNode workspace) {}
    public record ErrorResponse(String detail) {}
    public record Head(String revision, List<String> chunks, List<String> previousChunks, String checksum, long compressedBytes,
                       long jsonBytes, String updatedAt, String updatedBy) {}
}
