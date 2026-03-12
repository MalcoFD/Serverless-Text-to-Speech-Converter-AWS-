import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// Inicialización de los clientes de AWS SDK v3
const polly = new PollyClient({});
const s3 = new S3Client({});
const ses = new SESClient({});

//Aquí debes colocar tu propio bucket de S3 y el correo electrónico verificado en SES para enviar los correos
const BUCKET_NAME = "TU_BUCKET_S3_DESTINO"; 
const SENDER_EMAIL = "tu-correo-verificado-en-ses@ejemplo.com"; 

export const handler = async (event) => {
    try {
        // 1. Extraer el payload recibido desde API Gateway (Integración Proxy)
        const body = JSON.parse(event.body);
        const { email, text } = body;

        // 2. Sintetizar el texto a voz utilizando Amazon Polly
        const pollyParams = {
            OutputFormat: "mp3",
            Text: text,
            VoiceId: "Lupe", 
            Engine: "neural"  
        };
        const pollyResponse = await polly.send(new SynthesizeSpeechCommand(pollyParams));

        // Convertir el stream de audio entrante a un Buffer manejable
        const chunks = [];
        for await (let chunk of pollyResponse.AudioStream) {
            chunks.push(chunk);
        }
        const audioBuffer = Buffer.concat(chunks);

        // 3. Almacenar el archivo MP3 generado en el Bucket S3
        const fileName = `audio-${Date.now()}.mp3`;
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: audioBuffer,
            ContentType: "audio/mpeg"
        }));

        // 4. Generar una URL Presignada de S3 (Caducidad configurada a 1 hora / 3600s)
        const getCommand = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: fileName });
        const signedUrl = await getSignedUrl(s3, getCommand, { expiresIn: 3600 });

        // 5. Enviar el enlace de descarga por correo electrónico mediante Amazon SES
        const emailParams = {
            Destination: { ToAddresses: [email] },
            Message: {
                Body: {
                    Html: { 
                        Data: `
                            <h2 style="color: #ff9900;">Tu audio está listo</h2>
                            <p>Has solicitado convertir tu texto a voz. Descarga tu archivo MP3 en el siguiente enlace. <b>Nota: Este enlace caducará en 1 hora.</b></p>
                            <a href="${signedUrl}" style="background-color: #ff9900; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Descargar Audio MP3</a>
                        ` 
                    }
                },
                Subject: { Data: "AWS Polly: Tu audio generado exitosamente" }
            },
            Source: SENDER_EMAIL
        };
        await ses.send(new SendEmailCommand(emailParams));

        // 6. Retornar respuesta HTTP 200 exitosa al Frontend (Incluye headers CORS)
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "OPTIONS,POST"
            },
            body: JSON.stringify({ message: "Proceso completado exitosamente." })
        };

    } catch (error) {
        console.error("Error en la ejecución de la función Lambda:", error);
        
        // Retornar respuesta HTTP 500 en caso de fallo crítico
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: "Ocurrió un error interno en el servidor." })
        };
    }
};