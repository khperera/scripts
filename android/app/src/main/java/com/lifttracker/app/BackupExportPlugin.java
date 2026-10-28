package com.lifttracker.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "BackupExport")
public class BackupExportPlugin extends Plugin {
    private static final int MAX_BACKUP_BYTES = 20 * 1024 * 1024;

    @PluginMethod
    public void saveBackup(PluginCall call) {
        String filename = call.getString("filename");
        String content = call.getString("content");
        if (filename == null || !filename.matches("[A-Za-z0-9._-]+\\.json") ||
            content == null || content.getBytes(StandardCharsets.UTF_8).length > MAX_BACKUP_BYTES) {
            call.reject("The backup file is invalid or too large.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Uri downloads = DocumentsContract.buildDocumentUri(
                "com.android.externalstorage.documents", "primary:Download");
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, downloads);
        }
        startActivityForResult(call, intent, "handleSaveBackupResult");
    }

    @ActivityCallback
    private void handleSaveBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }

        Uri destination = result.getData().getData();
        if (destination == null) {
            call.reject("Android did not provide a destination for the backup.");
            return;
        }
        String content = call.getString("content");
        try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
            if (output == null) throw new IllegalStateException("Could not open the selected file");
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.flush();
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception error) {
            call.reject("Android could not write the selected backup file.");
        }
    }
}
