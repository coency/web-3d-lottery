import QRCode from 'qrcode';
export const joinQr=url=>QRCode.toDataURL(url,{width:640,margin:2,errorCorrectionLevel:'M'});
