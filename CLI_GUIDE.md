# Build & Service CLI Guide

Untuk membangun (build) aplikasi WebOS beserta service-nya, Anda memerlukan **webOS TV CLI (ares-cli)**.

## 1. Perintah Build (Packaging)

Gunakan `ares-package` untuk menggabungkan folder aplikasi utama dan folder service ke dalam satu file `.ipk`.

```powershell
# Jalankan dari root direktori proyek
ares-package --no-minify . iptv_service
```

> [!TIP]
> Jika `ares-package` tetap mencoba memproses folder `.agent` meskipun ada `.aresignore`, gunakan flag `--no-minify` seperti di atas untuk melewati tahap pengecilan kode yang menyebabkan error.

- `.` : Direktori aplikasi (berisi `appinfo.json`).
- `iptv_service` : Direktori service (berisi `services.json`).

Setelah dijalankan, akan muncul file seperti `com.iptv.khalid_1.1.0_all.ipk`.

---

## 2. Perintah Penting Lainnya

### Install ke TV/Emulator
```powershell
ares-install --device <DEVICE_NAME> <FILENAME>.ipk
```
*(Gunakan `ares-setup-device --list` untuk melihat nama device yang terhubung).*

### Jalankan Aplikasi
```powershell
ares-launch --device <DEVICE_NAME> com.iptv.khalid
```

### Lihat Log Service (Debugging)
Sangat berguna untuk melihat output dari `helloworld_service.js`:
```powershell
ares-inspect --device <DEVICE_NAME> --service com.iptv.khalid.service --open
```

---

## 4. Troubleshooting (Error & Solusi)

### Error: SSH Authentication Failed
Jika muncul error `ares-install ERR! novacom#Session()#begin() [ssh exec failure]: All configured authentication methods failed`:

1.  **Cek Passphrase**: Buka aplikasi **Developer Mode** di TV. Pastikan **Key Server** dalam kondisi **ON**.
2.  **Perbarui Key**: Jalankan perintah berikut untuk mengambil key terbaru dari TV:
    ```powershell
    # Ganti <DEVICE_NAME> dengan nama TV Anda (misal: omah)
    ares-novacom --device <DEVICE_NAME> --getkey
    ```
    Anda akan diminta memasukkan **Passphrase** yang muncul di layar TV.
3.  **Cek IP Address**: Pastikan IP TV tidak berubah. Jika berubah, update dengan:
    ```powershell
    ares-setup-device --modify <DEVICE_NAME> -i <NEW_IP_ADDRESS>
    ```

4.  **Hapus & Tambah Ulang (Opsi Terakhir)**:
    Jika masih gagal, hapus device dan tambahkan kembali:
    ```powershell
    ares-setup-device --remove omah
    # Tambahkan kembali (sesuaikan IP)
    ares-setup-device --add omah -i 192.168.x.x -p 9922 -u developer
    # Ambil key lagi
    ares-novacom --device omah --getkey
    ```

### Error: isDate is not a function
Jika muncul error `ares-install ERR! novacom#Session()#begin() [ssh exec failure]: isDate is not a function`:

**Penyebab**: Versi Node.js Anda terlalu baru (v18 ke atas) dan tidak kompatibel dengan library internal `ares-cli`.

**Solusi**: 
- Gunakan **Node.js versi 16** (LTS sebelumnya).
- Jika Anda menggunakan `nvm`, jalankan:
  ```powershell
  nvm install 16.20.2
  nvm use 16.20.2
  ```
- Setelah mengganti versi Node.js, coba jalankan `ares-install` kembali.

### Error: Failed to minify code
Gunakan flag `--no-minify` saat mem-build:
```powershell
ares-package --no-minify . iptv_service
```
