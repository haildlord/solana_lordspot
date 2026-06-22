import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import quoteRouter from './router/quoteRouter';
import webhookRouter from './router/webhookRouter';
import "./workers/ticketWorker";
import "./workers/baseRelayWorker";
import { megapotService } from "./services/megapotService";

const app = express();
app.use(express.json());

app.use(cors({
   origin: [`http://localhost:5173`, `https://lordspot.vercel.app`], // ! remove localhost in production
   methods: ['GET', 'POST']
}));

app.get(`/health`, (req: Request, res: Response) => {
    res.status(200).json({ message: 'Relayer Engine Online' });
});

// app.use(`/api`, quoteRouter);

app.use(`/api`, webhookRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Server is running on port: ${PORT}`);
    console.log("[SYSTEM]: Bootstrapping Megapot Sync Engine...");
    await megapotService.startSync();
});
