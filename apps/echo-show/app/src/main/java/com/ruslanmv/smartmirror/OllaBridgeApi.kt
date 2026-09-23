package com.ruslanmv.smartmirror

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

data class NodeInfo(
    val node_id: String,
    val node_name: String? = null,
    val platform: String? = null,
    val online: Boolean = false,
)

data class MirrorJobBody(
    val operation: String,
    val params: Map<String, Any?> = emptyMap(),
)

data class MirrorJobResponse(
    val job_id: String? = null,
    val status: String? = null,
    val node_id: String? = null,
)

interface OllaBridgeApi {
    @GET("/v1/mirror/nodes")
    suspend fun listNodes(): List<NodeInfo>

    @POST("/v1/mirror/nodes/{nodeId}/jobs")
    suspend fun createJob(
        @Path("nodeId") nodeId: String,
        @Body body: MirrorJobBody,
    ): MirrorJobResponse

    @GET("/v1/mirror/jobs/{jobId}")
    suspend fun getJob(
        @Path("jobId") jobId: String,
        @Query("node_id") nodeId: String,
    ): Map<String, Any?>
}
