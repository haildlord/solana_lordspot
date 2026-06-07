import { Request, Response } from "express";
import { QuoteRequest, Ticket } from "../interfaces/types";
import { PublicKey } from "@solana/web3.js";
import { megapotService } from "../services/megapotService";

export const quoteController = (req: Request, res: Response) => {
    try {

        const { tickets, userSolanaAddress, referrers, referralSplitBps }: QuoteRequest = req.body;

        if (!tickets || !userSolanaAddress || !referrers || !referralSplitBps) {
            return res.status(400).json({ message: 'Invalid request' });
        }


        const roundState = megapotService.getRoundState();
        if (!roundState) {
            return res.status(404).json({ message: 'No active round found' });
        }

        if (tickets.length === 0) {
            return res.status(400).json({ message: 'No tickets provided' });
        }
        
        try{
            const buyers_solana_addresses = new PublicKey(userSolanaAddress);
        }catch (error) {
            return res.status(400).json({ message: 'Invalid Solana public key format' });
        }

        if (referrers.length !== 1 || referralSplitBps.length !== 1) {
            return res.status(400).json({ message: 'Invalid referral structure: Exactly one referrer is allowed' });
        }

        if (referrers[0] !== process.env.LORDSPOT_BASE_REWARD_WALLET_ADDRESS) {
            return res.status(400).json({ message: 'Unauthorized referrer wallet address' });
        }

        if (referralSplitBps[0] !== 10000) {
            return res.status(400).json({ message: 'Referral split must allocate exactly 10000 BPS (100%) to the protocol wallet' });
        }

        const { normals_max, bonusball_max, ended_at } = roundState;
        
        if(normals_max === null || bonusball_max === null || ended_at === '') {
         throw new Error('Invalid round state');
        }

        const epochEndTime = new Date(ended_at).getTime();
        if (epochEndTime < Date.now()) {
            return res.status(503).json({ message: 'Trading unavailable: Current round has ended' });
        }

        for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            
            // 1. Strict Runtime Type Checking for the Array
            if (!ticket.normals || !Array.isArray(ticket.normals)) {
                return res.status(400).json({ message: `Ticket ${i} is malformed: 'normals' must be an array` });
            }
        
            if (ticket.normals.length !== 5) {
                return res.status(400).json({ message: `Ticket ${i} must contain exactly 5 normal numbers` });
            }
        
            // 2. Strict Runtime Checking for the Bonus Ball Bound
            if (typeof ticket.bonusball !== 'number' || ticket.bonusball < 1 || ticket.bonusball > bonusball_max) {
                return res.status(400).json({ message: `Ticket ${i} bonus ball is out of bounds (1-${bonusball_max})` });
            }
        
            // 3. The Inner Loop (Normals bounds & uniqueness)
            for (let j = 0; j < ticket.normals.length; j++) {
                const currentBall = ticket.normals[j];
                
                // Ensure it is actually a number at runtime
                if (typeof currentBall !== 'number') {
                    return res.status(400).json({ message: `Ticket ${i} normal ball at index ${j} must be a number` });
                }
            
                if (currentBall < 1 || currentBall > normals_max) {
                    return res.status(400).json({ message: `Ticket ${i} normal ball at index ${j} is out of bounds (1-${normals_max})` });
                }
            
                if (j > 0) {
                    const previousBall = ticket.normals[j - 1];
                    if (currentBall <= previousBall) {
                        return res.status(400).json({ message: `Ticket ${i} normal balls must be unique and sorted in increasing order` });
                    }
                }
            }
        }
        return res.status(200).json({ message: 'Success form : Quote Controller', roundState });
    
    }catch (error) {
        console.error('Error in quoteController:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};