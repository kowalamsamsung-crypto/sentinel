package pl.sentinel.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Size;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Skaner kodów (QR, kreskowe) z aparatu - ta sama logika co w QCDefectScan:
 * CameraX 1.3.4 + ML Kit (offline), analiza 1920x1080, tap-to-focus, zoom, latarka.
 * Zwraca odczytany tekst w extra "code".
 */
public class ScanActivity extends AppCompatActivity {

    private PreviewView previewView;
    private Camera camera;
    private ExecutorService analysisExecutor;
    private BarcodeScanner scanner;
    private boolean done = false;
    private boolean torchOn = false;
    private ActivityResultLauncher<String> permissionLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        scanner = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                        Barcode.FORMAT_QR_CODE,
                        Barcode.FORMAT_DATA_MATRIX,
                        Barcode.FORMAT_CODE_128,
                        Barcode.FORMAT_CODE_39,
                        Barcode.FORMAT_CODE_93,
                        Barcode.FORMAT_EAN_13,
                        Barcode.FORMAT_EAN_8,
                        Barcode.FORMAT_UPC_A,
                        Barcode.FORMAT_UPC_E)
                .build());
        analysisExecutor = Executors.newSingleThreadExecutor();
        buildUi();

        permissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {
                    if (granted) startCamera();
                    else { setResult(RESULT_CANCELED); finish(); }
                });

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            permissionLauncher.launch(Manifest.permission.CAMERA);
        }
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        // Dotknięcie podglądu = ostrość w tym punkcie
        previewView.setOnTouchListener((v, ev) -> {
            if (ev.getAction() == MotionEvent.ACTION_UP) focusAt(ev.getX(), ev.getY());
            return true;
        });
        root.addView(previewView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView hint = new TextView(this);
        hint.setText("Najedź na kod QR lub kreskowy. Dotknij kodu, aby wyostrzyć.");
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(14);
        hint.setBackgroundColor(0xAA000000);
        hint.setPadding(32, 24, 32, 24);
        root.addView(hint, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setBackgroundColor(0xAA000000);
        bottom.setPadding(32, 16, 32, 32);

        TextView zoomLabel = new TextView(this);
        zoomLabel.setText("Zoom");
        zoomLabel.setTextColor(Color.WHITE);
        bottom.addView(zoomLabel);

        SeekBar zoom = new SeekBar(this);
        zoom.setMax(100);
        zoom.setProgress(0);
        zoom.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean fromUser) {
                if (camera != null && fromUser) camera.getCameraControl().setLinearZoom(p / 100f);
            }
            @Override public void onStartTrackingTouch(SeekBar s) {}
            @Override public void onStopTrackingTouch(SeekBar s) {}
        });
        bottom.addView(zoom);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);

        Button btnFocus = new Button(this);
        btnFocus.setText("Ostrość");
        btnFocus.setOnClickListener(v -> focusCenter());
        row.addView(btnFocus, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button btnTorch = new Button(this);
        btnTorch.setText("Latarka");
        btnTorch.setOnClickListener(v -> {
            torchOn = !torchOn;
            if (camera != null) camera.getCameraControl().enableTorch(torchOn);
        });
        row.addView(btnTorch, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button btnClose = new Button(this);
        btnClose.setText("Anuluj");
        btnClose.setOnClickListener(v -> { setResult(RESULT_CANCELED); finish(); });
        row.addView(btnClose, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        bottom.addView(row);
        root.addView(bottom, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));

        setContentView(root);
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                        .setTargetResolution(new Size(1920, 1080))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();
                analysis.setAnalyzer(analysisExecutor, this::analyze);

                provider.unbindAll();
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);
            } catch (Exception e) {
                setResult(RESULT_CANCELED);
                finish();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void analyze(ImageProxy proxy) {
        if (done) { proxy.close(); return; }
        android.media.Image media = proxy.getImage();
        if (media == null) { proxy.close(); return; }
        InputImage input = InputImage.fromMediaImage(media, proxy.getImageInfo().getRotationDegrees());
        scanner.process(input)
                .addOnSuccessListener(barcodes -> {
                    for (Barcode bc : barcodes) {
                        String value = bc.getRawValue();
                        if (value != null && !value.trim().isEmpty() && !done) {
                            done = true;
                            Intent data = new Intent();
                            data.putExtra("code", value.trim());
                            setResult(RESULT_OK, data);
                            runOnUiThread(this::finish);
                            break;
                        }
                    }
                })
                .addOnCompleteListener(task -> proxy.close());
    }

    private void focusCenter() {
        focusAt(previewView.getWidth() / 2f, previewView.getHeight() / 2f);
    }

    private void focusAt(float x, float y) {
        if (camera == null || previewView.getWidth() == 0) return;
        MeteringPoint point = previewView.getMeteringPointFactory().createPoint(x, y);
        FocusMeteringAction action = new FocusMeteringAction.Builder(point,
                FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE)
                .setAutoCancelDuration(3, TimeUnit.SECONDS)
                .build();
        camera.getCameraControl().startFocusAndMetering(action);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (analysisExecutor != null) analysisExecutor.shutdown();
        if (scanner != null) scanner.close();
    }
}
