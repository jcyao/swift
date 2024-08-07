import Groq from "groq-sdk";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";

const groq = new Groq();

const schema = zfd.formData({
	input: z.union([zfd.text(), zfd.file()]),
	message: zfd.repeatableOfType(
		zfd.json(
			z.object({
				role: z.enum(["user", "assistant"]),
				content: z.string(),
			})
		)
	),
});

export async function POST(request: Request) {
	console.time("transcribe " + request.headers.get("x-vercel-id") || "local");

	const { data, success } = schema.safeParse(await request.formData());
	if (!success) return new Response("Invalid request", { status: 400 });

	const transcript = await getTranscript(data.input);
	if (!transcript) return new Response("Invalid audio", { status: 400 });

	console.timeEnd(
		"transcribe " + request.headers.get("x-vercel-id") || "local"
	);
	console.time(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	const completion = await groq.chat.completions.create({
		model: "llama-3.1-70b-versatile",
		messages: [
			{
				role: "system",
				content: `# 京东特快
简介：提供时效领先、安全可靠、服务周到的高品质门到门寄递服务
时效承诺：1 小时上门揽收、最快当日送达安全可靠：为您提供全程物流轨迹跟踪，保障货物安全
服务优势：100% 送货上门，专业客服团队售后保障
# 京东标快
简介：提供时效领先、安全可靠、服务周到的高品质门到门寄递服务
性价比高：价格优惠，大众价格享受高端服务服务范围：中国大陆地区全境送达
品质服务：提供个性化增值服务、多元化收寄方式

以上是相关产品信息，下面是任务描述
你是京东快递的AI寄快递助手名叫'小东'，需要帮助有潜在寄件需求的用户完成寄件下单。首先你需要确认用户是否有寄件需求，如果有则引导用户说出想要使用的'产品名'（京东特快/京东标快）、寄件'物品类型' '重量'、寄件人'姓名' '地址' '电话'、收件人'姓名' '地址' '电话'，当用户提供以上所有字段信息后，列出以上信息让用户确认。
你需要以热情、周到的服务引导用户完成寄快递动作。用户提出疑惑时为用户解答疑惑。成交后赞美用户，时刻注意提升用户满意度。现在的时间是 ${time()}
请以口语化表达，尽量简短的回复进行每轮对话，通过多轮对话完成以上任务。`,
			},
			...data.message,
			{
				role: "user",
				content: transcript,
			},
		],
	});

	const response = completion.choices[0].message.content;
	console.timeEnd(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	console.time(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	const tts_token = await fetch("https://japanwest.api.cognitive.microsoft.com/sts/v1.0/issueToken", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"Ocp-Apim-Subscription-Key": "7308761dbf1a410dab9628dde0f603e8",
		},
	});

	const voice = await fetch("https://japanwest.tts.speech.microsoft.com/cognitiveservices/v1", {
		method: "POST",
		headers: {
			"X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm",
			"Content-Type": "application/ssml+xml",
			"Authorization": "Bearer " + tts_token,
			"User-Agent": "1",
		},
		body: `<speak version='1.0' xml:lang='en-US'>
    <voice name="zh-CN-XiaoxiaoNeural">
        ` + response + `
    </voice>
</speak>`
	});

	// const voice1 = await fetch("https://api.cartesia.ai/tts/bytes", {
	// 	method: "POST",
	// 	headers: {
	// 		"Cartesia-Version": "2024-06-30",
	// 		"Content-Type": "application/json",
	// 		"X-API-Key": process.env.CARTESIA_API_KEY!,
	// 	},
	// 	body: JSON.stringify({
	// 		model_id: "sonic-multilingual",
	// 		language: "zh",
	// 		transcript: response,
	// 		voice: {
	// 			mode: "id",
	// 			id: "3a63e2d1-1c1e-425d-8e79-5100bc910e90",
	// 		},
	// 		output_format: {
	// 			container: "raw",
	// 			encoding: "pcm_f32le",
	// 			sample_rate: 24000,
	// 		},
	// 	}),
	// });

	console.timeEnd(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	if (!voice.ok) {
		console.error(await voice.text());
		return new Response("Voice synthesis failed", { status: 500 });
	}

	console.time("stream " + request.headers.get("x-vercel-id") || "local");
	after(() => {
		console.timeEnd(
			"stream " + request.headers.get("x-vercel-id") || "local"
		);
	});

	return new Response(voice.body, {
		headers: {
			"X-Transcript": encodeURIComponent(transcript),
			"X-Response": encodeURIComponent(response),
		},
	});
}

function location() {
	const headersList = headers();

	const country = headersList.get("x-vercel-ip-country");
	const region = headersList.get("x-vercel-ip-country-region");
	const city = headersList.get("x-vercel-ip-city");

	if (!country || !region || !city) return "unknown";

	return `${city}, ${region}, ${country}`;
}

function time() {
	return new Date().toLocaleString("en-US", {
		timeZone: headers().get("x-vercel-ip-timezone") || undefined,
	});
}

async function getTranscript(input: string | File) {
	if (typeof input === "string") return input;

	try {
		const { text } = await groq.audio.transcriptions.create({
			file: input,
			model: "whisper-large-v3",
			language: "zh"
		});

		return text.trim() || null;
	} catch {
		return null; // Empty audio file
	}
}
