package com.ruslanmv.smartmirror

sealed interface CameraSource {
    data object EchoShowCamera : CameraSource
    data object CompanionCamera : CameraSource
    data object NetworkCamera : CameraSource
    data object UploadedPhoto : CameraSource
}
