-- Update existing status values to match new enum
UPDATE conversations SET status = 'OPEN' WHERE status = 'open';
UPDATE conversations SET status = 'CLOSED' WHERE status = 'closed';
UPDATE conversations SET status = 'CLOSED' WHERE status = 'archived';
