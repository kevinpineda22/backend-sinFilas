/**
 * Calcula el dígito de verificación para un código EAN-13
 */
export const calculateCheckDigit = (barcode) => {
  if (!barcode || barcode.length < 12) return 0;
  
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(barcode[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
};

/**
 * Genera un código de barras GS1 (Fruver/Carnicería) con el peso integrado
 */
export const generateGs1Barcode = (baseCode, weightKg) => {
  const weightGrams = Math.round(weightKg * 1000);
  const weightStr = weightGrams.toString().padStart(5, '0');
  
  let codeWithoutCheck = baseCode;
  if (codeWithoutCheck.length > 7) {
    codeWithoutCheck = codeWithoutCheck.substring(0, 7);
  } else if (codeWithoutCheck.length < 7) {
    codeWithoutCheck = codeWithoutCheck.padEnd(7, '0');
  }
  
  codeWithoutCheck = codeWithoutCheck + weightStr;
  const checkDigit = calculateCheckDigit(codeWithoutCheck);
  
  return codeWithoutCheck + checkDigit;
};

/**
 * Genera el string para el código QR simulando el escaneo en el POS.
 * Cada línea va separada por \r\n. 
 * EAN normales usan el formato: QTY*CODE
 * GS1 (Pesables 29) van directos ya que contienen el peso y QTY=1 implícito
 */
export const generateManifestQRValue = (items) => {
  return items
    .map((item) => {
      const code = item.codigo_barras || "";
      const isGS1 = code.startsWith('29') && code.length >= 13;
      
      if (isWeighableProduct(item.unidad_medida) || isGS1) {
        return code; // Directo sin multiplicador
      }
      
      const qty = item.cantidad || 1;
      return `${qty}*${code}`;
    })
    .filter(Boolean)
    .join("\r\n");
};

// Helper interno para identificar UM de peso
const isWeighableProduct = (um) => {
  if (!um) return false;
  const unit = um.toUpperCase();
  return ['KL', 'LB', '500GR', '250GR'].includes(unit);
};
