package com.ruslanmv.smartmirror

import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object OllaBridgeClient {
    fun create(baseUrl: String, token: String): OllaBridgeApi {
        val http = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request().newBuilder()
                    .header("Authorization", "Bearer $token")
                    .build()
                chain.proceed(request)
            }
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl.trimEnd('/') + "/")
            .client(http)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(OllaBridgeApi::class.java)
    }
}
