(function (root) {
    "use strict";

    // Each page is a single image of the prepared DOM, so the PDF cannot
    // independently reflow the tooltip, legend, or location label.
    function buildPdf(pages) {
        const encoder = new TextEncoder();
        const chunks = [];
        const offsets = [0];
        let length = 0;
        const append = function (value) {
            const bytes = typeof value === "string" ? encoder.encode(value) : value;
            chunks.push(bytes);
            length += bytes.length;
        };
        const object = function (id, body, stream) {
            offsets[id] = length;
            append(`${id} 0 obj\n${body}`);
            if (stream) {
                append(`\nstream\n`);
                append(stream);
                append("\nendstream");
            }
            append("\nendobj\n");
        };
        append("%PDF-1.4\n");
        object(1, "<< /Type /Catalog /Pages 2 0 R >>");
        object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${
            pages.map(function (_, i) { return `${3 + i * 3} 0 R`; }).join(" ")
        }] >>`);
        pages.forEach(function (page, i) {
            const id = 3 + i * 3;
            const w = page.landscape ? 841.8898 : 595.2756;
            const h = page.landscape ? 595.2756 : 841.8898;
            object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Map ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
            object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>`, page.bytes);
            const content = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Map Do Q`);
            object(id + 2, `<< /Length ${content.length} >>`, content);
        });
        const xref = length;
        append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
        offsets.slice(1).forEach(function (offset) {
            append(`${String(offset).padStart(10, "0")} 00000 n \n`);
        });
        append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
        return new Blob(chunks, { type: "application/pdf" });
    }

    async function capturePage(page) {
        const landscape = page.classList.contains("drought-map-report-page--landscape");
        const width = (landscape ? 297 : 210) / 25.4 * 96;
        const height = (landscape ? 210 : 297) / 25.4 * 96;
        const clone = page.cloneNode(true);
        const originals = [page, ...page.querySelectorAll("*")];
        const copies = [clone, ...clone.querySelectorAll("*")];
        originals.forEach(function (element, index) {
            const style = getComputedStyle(element);
            const copy = copies[index];
            copy.removeAttribute("id");
            copy.style.cssText = Array.from(style).map(function (property) {
                return `${property}:${style.getPropertyValue(property)};`;
            }).join("");
        });
        for (const image of clone.querySelectorAll("img")) {
            const original = originals[copies.indexOf(image)];
            const canvas = document.createElement("canvas");
            canvas.width = original.naturalWidth;
            canvas.height = original.naturalHeight;
            canvas.getContext("2d").drawImage(original, 0, 0);
            image.src = canvas.toDataURL("image/png");
            image.removeAttribute("srcset");
        }
        clone.style.margin = "0";
        clone.style.zoom = "1";
        clone.style.width = `${width}px`;
        clone.style.height = `${height}px`;
        clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * 2);
        canvas.height = Math.round(height * 2);
        const context = canvas.getContext("2d");
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(function (resolve) {
            canvas.toBlob(resolve, "image/jpeg", 0.95);
        });
        if (!blob) throw new Error("Unable to capture PDF page.");
        return { landscape, width: canvas.width, height: canvas.height,
            bytes: new Uint8Array(await blob.arrayBuffer()) };
    }

    async function download(elements, progress) {
        await document.fonts.ready;
        const pages = [];
        for (const element of elements) {
            progress(pages.length + 1, elements.length);
            pages.push(await capturePage(element));
        }
        const url = URL.createObjectURL(buildPdf(pages));
        const link = document.createElement("a");
        link.href = url;
        link.download = "agricultural-drought-maps.pdf";
        link.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    root.ADDMapReportPdf = Object.freeze({ download, buildPdf });
}(window));
