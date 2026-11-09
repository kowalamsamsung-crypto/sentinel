package pl.sentinel.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Most między stroną SENTINEL (JavaScript) a natywnym skanerem ScanActivity. */
@CapacitorPlugin(name = "SentinelScanner")
public class ScannerPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        Intent intent = new Intent(getContext(), ScanActivity.class);
        startActivityForResult(call, intent, "scanResult");
    }

    /** Zapis pliku do cache i okno "Udostępnij" (np. Excel / zdjęcie tabeli). */
    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            String name = call.getString("name", "plik.bin").replaceAll("[^A-Za-z0-9._-]", "_");
            String mime = call.getString("mime", "application/octet-stream");
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            File dir = new File(getContext().getCacheDir(), "shared");
            dir.mkdirs();
            File f = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(bytes); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, name);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Nie udało się udostępnić pliku: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void scanResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            String code = result.getData().getStringExtra("code");
            if (code != null && !code.isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("value", code);
                call.resolve(ret);
                return;
            }
        }
        call.reject("cancelled");
    }
}
