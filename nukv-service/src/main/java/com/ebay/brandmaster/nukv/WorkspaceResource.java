package com.ebay.brandmaster.nukv;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Controller;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Controller
@Path("/v1/workspace")
@Produces(MediaType.APPLICATION_JSON)
public class WorkspaceResource {
    private static final Logger LOG = LoggerFactory.getLogger(WorkspaceResource.class);
    private final WorkspaceRepository repository;
    private final String serviceSecret;

    public WorkspaceResource(WorkspaceRepository repository,
                             @Value("${brandmaster.gateway.secret}") String serviceSecret) {
        this.repository = repository;
        this.serviceSecret = serviceSecret;
    }

    @GET
    public Response read(@HeaderParam("X-Brandmaster-Service-Secret") String suppliedSecret) {
        Response denied = authorize(suppliedSecret); if (denied != null) return denied;
        try { return Response.ok(repository.read()).build(); }
        catch (Exception error) { return failure(error); }
    }

    @PUT
    @Consumes(MediaType.APPLICATION_JSON)
    public Response write(@HeaderParam("X-Brandmaster-Service-Secret") String suppliedSecret,
                          WorkspacePayloads.WriteRequest request) {
        Response denied = authorize(suppliedSecret); if (denied != null) return denied;
        if (request == null || request.syncedBy() == null || request.syncedBy().isBlank()) {
            return Response.status(400).entity(new WorkspacePayloads.ErrorResponse("syncedBy is required")).build();
        }
        try { return Response.ok(repository.write(request.baseRevision(), request.workspace(), request.syncedBy())).build(); }
        catch (WorkspaceRepository.RevisionConflictException conflict) {
            return Response.status(409).entity(new WorkspacePayloads.ErrorResponse("The shared workspace changed. Pull the latest revision and merge before saving.")).build();
        }
        catch (IllegalArgumentException error) {
            return Response.status(400).entity(new WorkspacePayloads.ErrorResponse(error.getMessage())).build();
        }
        catch (Exception error) { return failure(error); }
    }

    private Response authorize(String suppliedSecret) {
        if (serviceSecret == null || serviceSecret.isBlank()) return Response.status(503).entity(new WorkspacePayloads.ErrorResponse("Gateway secret is not configured")).build();
        if (!constantTimeEquals(serviceSecret, suppliedSecret)) return Response.status(401).entity(new WorkspacePayloads.ErrorResponse("Unauthorized sync service")).build();
        return null;
    }

    private static boolean constantTimeEquals(String expected, String supplied) {
        if (supplied == null) return false;
        byte[] left = expected.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] right = supplied.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return java.security.MessageDigest.isEqual(left, right);
    }

    private Response failure(Exception error) {
        LOG.error("NuKV workspace operation failed", error);
        return Response.status(503).entity(new WorkspacePayloads.ErrorResponse("NuKV workspace storage is temporarily unavailable")).build();
    }
}
