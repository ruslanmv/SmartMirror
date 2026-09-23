package com.ruslanmv.smartmirror

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                SmartMirrorHome()
            }
        }
    }
}

@Composable
fun SmartMirrorHome() {
    Column(
        modifier = Modifier.fillMaxSize().padding(48.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("SmartMirror", style = MaterialTheme.typography.headlineLarge)
        Text("Pair with OllaBridge to connect to your HomePilot.")
        Button(
            onClick = { /* Pairing flow milestone */ },
            modifier = Modifier.focusable(),
        ) {
            Text("Pair device")
        }
        Button(
            onClick = { /* Wardrobe screen milestone */ },
            modifier = Modifier.focusable(),
        ) {
            Text("My wardrobe")
        }
        Button(
            onClick = { /* Stylist screen milestone */ },
            modifier = Modifier.focusable(),
        ) {
            Text("Ask stylist")
        }
    }
}
