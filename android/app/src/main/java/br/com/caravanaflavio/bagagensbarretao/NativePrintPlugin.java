package br.com.caravanaflavio.bagagensbarretao;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {

    @PluginMethod
    public void printCurrentWebView(PluginCall call) {
        String jobName = call.getString("jobName", "Bagagens Barretão");

        getActivity().runOnUiThread(() -> {
            try {
                PrintManager printManager =
                    (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);

                WebView webView = getBridge().getWebView();
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);

                PrintAttributes attributes = new PrintAttributes.Builder().build();
                printManager.print(jobName, adapter, attributes);
                call.resolve();
            } catch (Exception error) {
                call.reject("Não foi possível abrir a impressão no Android.", error);
            }
        });
    }
}
