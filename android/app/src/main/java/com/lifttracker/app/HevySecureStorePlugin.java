package com.lifttracker.app;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "HevySecureStore")
public class HevySecureStorePlugin extends Plugin {
    private static final String PREFS = "hevy_secure_store";
    private static final String VALUE = "encrypted_api_key";
    private static final String KEY_ALIAS = "com.lifttracker.app.hevy.api_key.v1";
    private static final int MAX_KEY_LENGTH = 4096;
    private static final int GCM_TAG_BITS = 128;

    @PluginMethod
    public void saveApiKey(PluginCall call) {
        String apiKey = call.getString("apiKey");
        if (apiKey == null || apiKey.trim().isEmpty() || apiKey.length() > MAX_KEY_LENGTH) {
            call.reject("Enter a valid Hevy API key.");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] ciphertext = cipher.doFinal(apiKey.trim().getBytes(StandardCharsets.UTF_8));
            String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." +
                Base64.encodeToString(ciphertext, Base64.NO_WRAP);
            if (!preferences().edit().putString(VALUE, stored).commit()) {
                throw new IllegalStateException("Encrypted key could not be written");
            }
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception error) {
            call.reject("Android could not securely save the Hevy key. Check device lock/security settings and try again.");
        }
    }

    @PluginMethod
    public void getApiKey(PluginCall call) {
        String stored = preferences().getString(VALUE, null);
        if (stored == null) {
            call.resolve(new JSObject().put("apiKey", "").put("saved", false));
            return;
        }
        try {
            String[] parts = stored.split("\\.", 2);
            if (parts.length != 2) throw new IllegalStateException("Invalid encrypted key data");
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            SecretKey key = getExistingKey();
            if (key == null) throw new IllegalStateException("Device encryption key is unavailable");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            String apiKey = new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("apiKey", apiKey).put("saved", true));
        } catch (Exception error) {
            // A restored encrypted preference cannot be used without its device-bound key.
            preferences().edit().remove(VALUE).commit();
            call.reject("The saved Hevy key could not be decrypted on this device. Enter it again.");
        }
    }

    @PluginMethod
    public void deleteApiKey(PluginCall call) {
        boolean removed = preferences().edit().remove(VALUE).commit();
        if (!removed) {
            call.reject("Android could not remove the encrypted Hevy key. Try again.");
            return;
        }
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
            call.resolve(new JSObject().put("deleted", true));
        } catch (Exception error) {
            call.reject("Android could not fully remove the saved Hevy key. Try again.");
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        SecretKey existing = getExistingKey();
        if (existing != null) return existing;

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private SecretKey getExistingKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
        return existing instanceof SecretKey ? (SecretKey) existing : null;
    }
}
