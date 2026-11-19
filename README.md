# Constructores (páginas, fichas y editor)

Herramientas que funcionan 100 % en el navegador (Chrome o Edge), sin servidor ni claves.

```
index.html          menú
paginas/            constructor de páginas
fichas/             constructor de fichas
editor/             editor de documentos (PDF)
images/             imágenes y mascotas (la galería las lista)
instalacion.js      código compartido (galería, carpeta de trabajo, borradores)
logo.png            (opcional) logo del sitio, en la raíz
```

## Usarlo desde GitHub Pages
1. En el repositorio: **Settings → Pages → Deploy from a branch → main / (root)**.
2. Abrí `https://USUARIO.github.io/REPOSITORIO/`.
3. La **galería** muestra las imágenes de `images/` del repositorio (marcadas con 🌐).

## Agregar imágenes y guardar trabajo (carpeta de tu PC)
Una página web no puede escribir en GitHub, así que se usa una carpeta local:
1. Clonás el repositorio en tu PC (GitHub Desktop → *Clone*) o copiás la carpeta.
2. En la herramienta: **Conectar carpeta** → elegí la carpeta del repositorio (la que tiene `images/`).
3. **Agregar imagen** copia el archivo a `images/`; **Guardar** crea `borradores/<tipo>/`; **Guardar HTML** crea `publicar/`.
4. Para que la imagen aparezca en la galería de la web: *commit* y *push* (GitHub Desktop) o subila en github.com → *Add file → Upload files*.
   La automatización `.github/workflows/lista-imagenes.yml` actualiza sola `images/lista.json`.

`borradores/` y `publicar/` están en `.gitignore`: se quedan en tu PC.

## Notas
- Si el repositorio es público, todo (incluido el editor) es visible para cualquiera con el enlace.
- "Traer de URL" necesita que tu sitio permita CORS; si no, guardá la página con Ctrl+S ("solo HTML") y abrila con el botón de importar.
- También funciona abriendo `index.html` directo desde la carpeta, sin internet.
